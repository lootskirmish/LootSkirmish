// ============================================================
// AUTH.JS - Sistema de Autenticação
// ============================================================

import { createClient, Session, User, AuthError } from '@supabase/supabase-js';
import { showToast, showAlert } from '../shared/effects';
import { store, authActions, dataActions } from '../core/store';
import { clearActiveUser, setActiveUser, fetchCsrfToken, clearCsrfTokenOnServer, getActiveUser } from '../core/session';

// ============ TYPE DEFINITIONS ============
interface PendingReferral {
  code: string;
  userId?: string;
}

interface HCaptchaWidgets {
  login: number | null;
  register: number | null;
}

interface HCaptchaInstance {
  render: (container: HTMLElement, config: any) => number;
  reset: (widgetId: number) => void;
}

declare global {
  interface Window {
    hcaptcha?: HCaptchaInstance;
    HCAPTCHA_SITEKEY?: string;
    currentUser?: any;
    playerMoney?: { value: number };
    playerDiamonds?: { value: number };
    cachedUnlockedPasses?: string[];
    cachedDiamonds?: number;
    cachedCaseDiscountLevel?: number;
    willRestoreState?: boolean;
    __suppressCurrencyPopups?: boolean;
    cleanupChat?: () => void;
    cleanupFriends?: () => void;
    invalidateAdminRoleCache?: () => void;
    checkRouteAuth?: () => void;
    goTo?: (screen: string) => void;
    setChatToggleIcon?: (config: any) => void;
    refreshLucideIcons?: () => void;
    handleLogin: typeof handleLogin;
    handleRegister: typeof handleRegister;
    handlePasswordReset: typeof handlePasswordReset;
    handleUpdatePassword: typeof handleUpdatePassword;
    updatePasswordAfterReset: typeof updatePasswordAfterReset;
  }
}

// ============ SUPABASE CONFIG ============
// 🔒 Usando variáveis de ambiente para segurança
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const LAST_ACTIVITY_KEY = 'ls-last-activity';
const PENDING_REFERRAL_KEY = 'pending-referral-link';
const AUTO_LOGIN_EXPIRY_DAYS = 3; // Forçar login manual após 3 dias de inatividade
// Vite substitui import.meta.env em build; fallback para window.* caso seja injetado manualmente
const HCAPTCHA_SITEKEY = (import.meta.env?.VITE_HCAPTCHA_SITEKEY ?? null)
  || window.HCAPTCHA_SITEKEY
  || null;
const CAPTCHA_REQUIRED = Boolean(HCAPTCHA_SITEKEY);

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true, // 🔥 PRECISA TRUE para pegar tokens do reset link
    storage: window.localStorage,
    storageKey: 'sb-auth-token',
    flowType: 'implicit' // 🔥 MUDEI PARA IMPLICIT (mais simples)
  },
  global: {
    headers: {
      'X-Client-Info': 'loot-skirmish-web'
    }
  }
});

let authStateSubscription: { unsubscribe: () => void } | null = null;
let loginCaptchaToken: string | null = null;
let registerCaptchaToken: string | null = null;
let hcaptchaWidgets: HCaptchaWidgets = { login: null, register: null };
let hcaptchaScriptPromise: Promise<HCaptchaInstance> | null = null;

// ============ HELPERS ============

/**
 * Atualiza timestamp de última atividade
 */
function updateLastActivity(): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  } catch {
    // Ignore storage errors
  }
}

/**
 * Verifica se a sessão expirou por inatividade (3 dias)
 * Retorna true se precisa login manual
 */
function shouldForceRelogin(): boolean {
  try {
    const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (!lastActivity) return false;
    
    const lastActivityTime = parseInt(lastActivity, 10);
    const threeDaysMs = AUTO_LOGIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - lastActivityTime;
    
    if (elapsed > threeDaysMs) {
      console.log('[AUTH] Sessão inativa por mais de 3 dias - forçando login manual');
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Limpa dados de sessão ao forçar relogin
 */
function clearSessionData(): void {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    localStorage.removeItem('sb-auth-token');
  } catch {
    // Ignore
  }
}

function setButtonLoading(button: HTMLButtonElement | null, isLoading: boolean): void {
  if (!button) return;
  button.classList.toggle('loading', isLoading);
  button.disabled = Boolean(isLoading);
}

function loadHCaptchaScript(): Promise<HCaptchaInstance> | null {
  if (!HCAPTCHA_SITEKEY) return null;
  if (hcaptchaScriptPromise) return hcaptchaScriptPromise;

  hcaptchaScriptPromise = new Promise((resolve, reject) => {
    if (window.hcaptcha) {
      resolve(window.hcaptcha);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.hcaptcha);
    script.onerror = () => reject(new Error('Failed to load hCaptcha'));
    document.head.appendChild(script);
  });

  return hcaptchaScriptPromise;
}

function resetCaptcha(which: 'login' | 'register'): void {
  if (!window.hcaptcha) return;
  const widgetId = hcaptchaWidgets[which];
  if (widgetId !== null && widgetId !== undefined) {
    try {
      window.hcaptcha.reset(widgetId);
    } catch (err) {
      console.warn('Could not reset hCaptcha', err);
    }
  }
  if (which === 'login') loginCaptchaToken = null;
  if (which === 'register') registerCaptchaToken = null;
}

function storePendingReferral(code: string, userId: string): void {
  if (!code) return;
  try {
    localStorage.setItem(PENDING_REFERRAL_KEY, JSON.stringify({ code, userId }));
  } catch {
    // ignore storage issues
  }
}

function readPendingReferral(): PendingReferral | null {
  try {
    const raw = localStorage.getItem(PENDING_REFERRAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearPendingReferral(): void {
  try {
    localStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    // ignore
  }
}

export async function handlePasswordReset(): Promise<void> {
  const emailEl = document.getElementById('login-email');
  const errorEl = document.getElementById('login-error');
  
  if (!emailEl?.value) {
    showAlert('warning', 'Enter Email ⚠️', 'Please enter your email address to reset your password.');
    return;
  }

  const email = emailEl.value;
  const captchaToken = CAPTCHA_REQUIRED ? loginCaptchaToken : null;
  
  if (CAPTCHA_REQUIRED && !captchaToken) {
    errorEl.textContent = 'Complete the captcha before sending reset link.';
    showAlert('warning', 'Captcha Required', 'Please complete the captcha to continue.');
    return;
  }

  try {
    console.log('🔑 Sending password reset email to:', email);
    const result = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth?reset=true`,
      captchaToken: captchaToken || undefined
    });
    const { error, data } = result;
    
    console.log('🔑 Reset response:', { error, data });
    
    if (error) {
      console.error('🔑 Reset error:', error);
      showAlert('error', 'Reset Failed ❌', error.message || 'Unable to send reset email.');
      resetCaptcha('login');
      return;
    }
    
    console.log('🔑 Reset email sent successfully');
    showAlert('success', 'Check Your Email! 📧', 'Password reset link sent. Check your email to continue.');
    errorEl.textContent = 'Password reset link sent to your email!';
    errorEl.className = 'auth-success';
    resetCaptcha('login');
  } catch (err) {
    console.error('Password reset error:', err);
    showAlert('error', 'Error ❌', 'Something went wrong. Please try again.');
  }
}

export async function updatePasswordAfterReset(newPassword: string): Promise<boolean> {
  if (!newPassword || newPassword.length < 6) {
    showAlert('error', 'Weak Password ❌', 'Password must be at least 6 characters.');
    return false;
  }
  
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  
  if (error) {
    showAlert('error', 'Update Failed ❌', error.message || 'Unable to update password.');
    return false;
  }
  
  showAlert('success', 'Password Updated! ✅', 'Your password has been changed successfully.');
  
  // Redirecionar para o app principal após 2 segundos
  setTimeout(() => {
    window.location.href = '/';
  }, 2000);
  
  return true;
}

export function handleUpdatePassword(): void {
  const newPasswordEl = document.getElementById('reset-new-password');
  const confirmPasswordEl = document.getElementById('reset-confirm-password');
  const errorEl = document.getElementById('reset-error');
  
  if (!newPasswordEl || !confirmPasswordEl || !errorEl) return;
  
  const newPassword = newPasswordEl.value;
  const confirmPassword = confirmPasswordEl.value;
  
  errorEl.textContent = '';
  
  if (!newPassword || !confirmPassword) {
    errorEl.textContent = 'Please fill in both fields';
    showAlert('warning', 'Missing Fields ⚠️', 'Enter your new password twice.');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    errorEl.textContent = 'Passwords do not match';
    showAlert('warning', 'Passwords Mismatch ⚠️', 'Make sure both passwords are the same.');
    return;
  }
  
  if (newPassword.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters';
    showAlert('warning', 'Weak Password ⚠️', 'Choose a stronger password (6+ characters).');
    return;
  }
  
  updatePasswordAfterReset(newPassword);
}

function detectPasswordReset(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const isReset = urlParams.get('reset') === 'true';
  const hasError = urlParams.get('error');
  
  if (isReset) {
    // Verificar se o link expirou
    if (hasError === 'access_denied' || urlParams.get('error_code') === 'otp_expired') {
      showAlert('error', 'Link Expired ❌', 'This reset link has expired. Please request a new one.');
      // Limpar URL e voltar para login
      window.history.replaceState({}, '', '/auth');
      return;
    }
    
    // Mostrar formulário de reset
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const resetForm = document.getElementById('reset-password-form');
    const authTabs = document.getElementById('auth-tabs');
    
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';
    if (resetForm) {
      resetForm.classList.remove('hidden');
      resetForm.style.display = 'block';
    }
    if (authTabs) authTabs.style.display = 'none';
    
    console.log('🔑 Password reset mode activated');
  }
}

/**
 * Verifica se o email foi confirmado e exibe um aviso visual apropriado
 */
async function checkEmailVerification(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  
  const isEmailConfirmed = session.user.email_confirmed_at !== null && session.user.email_confirmed_at !== undefined;
  
  if (!isEmailConfirmed) {
    // Email não confirmado - mostrar modal grande e visível
    showAlert('warning', '📧 Email Not Verified!', 
      'Please check your email and click the confirmation link to activate your account. You may need to check your spam folder.', 
      { duration: 0 }
    );
  }
}

function prefillReferralFromUrl(): void {
  try {
    // Suportar ambas as rotas: ?ref=username e /auth/ref/username
    const params = new URLSearchParams(window.location.search);
    const refFromQuery = params.get('ref');
    
    // Extrair do path: /auth/ref/username
    const pathMatch = window.location.pathname.match(/\/auth\/ref\/([^/]+)/);
    const refFromPath = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
    
    const ref = refFromQuery || refFromPath;
    if (!ref) return;
    
    // Ativar aba de signup automáticamente se vem por ref
    switchTab('register');
    
    const input = document.getElementById('register-referral-code');
    if (input) {
      input.value = ref;
    }
  } catch {
    // ignore
  }
}

async function attemptReferralLink(referralCode: string, userId: string, authToken: string): Promise<boolean> {
  if (!referralCode || !userId || !authToken) return false;
  try {
    const response = await fetch('/api/_referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'registerReferral',
        referralCode,
        userId,
        authToken
      })
    });
    if (response.ok) {
      clearPendingReferral();
      return true;
    }
  } catch (err) {
    console.warn('referral linking failed', err?.message || err);
  }
  return false;
}

async function syncPendingReferral(user: User): Promise<void> {
  const pending = readPendingReferral();
  if (!pending || !user?.id) return;
  if (pending.userId && pending.userId !== user.id) {
    clearPendingReferral();
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;
  await attemptReferralLink(pending.code, user.id, session.access_token);
}

async function renderHCaptcha(): Promise<void> {
  if (!HCAPTCHA_SITEKEY) {
    const blocks = [document.getElementById('login-captcha-block'), document.getElementById('register-captcha-block')];
    blocks.forEach(b => {
      if (b) b.style.display = 'block';
      const helper = b?.querySelector('.auth-helper');
      if (helper) helper.textContent = 'Captcha não configurado. Defina VITE_HCAPTCHA_SITEKEY e recarregue.';
    });

    const errors = [document.getElementById('login-error'), document.getElementById('register-error')];
    errors.forEach(el => {
      if (el) el.textContent = 'Captcha não configurado: adicione VITE_HCAPTCHA_SITEKEY e reinicie o app.';
    });

    const buttons = [document.querySelector('#login-form button'), document.querySelector('#register-form button')];
    buttons.forEach(btn => {
      if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
      }
    });
    return;
  }

  const hcaptcha = await loadHCaptchaScript();
  if (!hcaptcha) return;

  // Aguardar um pouco para garantir que o hCaptcha está totalmente carregado
  await new Promise(resolve => setTimeout(resolve, 100));

  const loginContainer = document.getElementById('login-hcaptcha');
  if (loginContainer && !loginContainer.dataset.rendered) {
    try {
      const widgetId = hcaptcha.render(loginContainer, {
        sitekey: HCAPTCHA_SITEKEY,
        callback: token => { loginCaptchaToken = token; },
        'expired-callback': () => { loginCaptchaToken = null; }
      });
      hcaptchaWidgets.login = widgetId;
      loginContainer.dataset.rendered = '1';
    } catch (err) {
      console.warn('Could not render login hCaptcha:', err);
    }
  }

  const registerContainer = document.getElementById('register-hcaptcha');
  if (registerContainer && !registerContainer.dataset.rendered) {
    try {
      const widgetId = hcaptcha.render(registerContainer, {
        sitekey: HCAPTCHA_SITEKEY,
        callback: token => { registerCaptchaToken = token; },
        'expired-callback': () => { registerCaptchaToken = null; }
      });
      hcaptchaWidgets.register = widgetId;
      registerContainer.dataset.rendered = '1';
    } catch (err) {
      console.warn('Could not render register hCaptcha:', err);
    }
  }
}

// ============ FUNÇÕES DE AUTENTICAÇÃO ============

/**
 * Alterna entre as abas de login e registro
 * @param {string} tab - 'login' ou 'register'
 */
export function switchTab(tab: 'login' | 'register'): void {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  if (!loginForm || !registerForm) return;

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  }
}

/**
 * Realiza o login do usuário
 */
export async function handleLogin(): Promise<void> {
  const emailEl = document.getElementById('login-email');
  const passwordEl = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  const termsEl = document.getElementById('login-terms-accept');
  const loginBtn = document.querySelector('#login-form button');
  if (!emailEl || !passwordEl || !errorEl) return;

  const email = emailEl.value;
  const password = passwordEl.value;
  const termsAccepted = !!termsEl?.checked;
  const captchaToken = CAPTCHA_REQUIRED ? loginCaptchaToken : null;

  errorEl.textContent = '';
  setButtonLoading(loginBtn, true);
  
  if (!email || !password) {
    errorEl.textContent = 'Complete all the fields';
    showAlert('warning', 'Missing Fields! ⚠️', 'Please fill in your email and password.');
    setButtonLoading(loginBtn, false);
    return;
  }

  if (!termsAccepted) {
    errorEl.textContent = 'You must agree to the Terms and Privacy Policy';
    showAlert('warning', 'Terms Required! ⚠️', 'Please accept the Terms of Use and Privacy Policy to continue.');
    setButtonLoading(loginBtn, false);
    return;
  }

  if (CAPTCHA_REQUIRED && !captchaToken) {
    errorEl.textContent = 'Complete the captcha before logging in.';
    showAlert('warning', 'Captcha Required', 'Please complete the captcha to continue.');
    setButtonLoading(loginBtn, false);
    return;
  }
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: {
      captchaToken: captchaToken || undefined
    }
  });
  
  console.log('🔐 Login attempt:', { email, error: error?.message || 'success' });

  if (error) {
    // Se o erro for que email não foi verificado, mostrar mensagem específica
    const isEmailNotVerified = error.message?.includes('Email not confirmed') || 
                              error.status === 403;
    
    if (isEmailNotVerified) {
      errorEl.textContent = 'Please verify your email before logging in.';
      showAlert('warning', '⚠️ Email Not Verified', 
        'You must confirm your email before logging in. Check your email (including spam folder) for the confirmation link.',
        { duration: 0 }
      );
    } else {
      errorEl.textContent = error.message;
      showAlert('error', 'Login Failed! ❌', error.message || 'Invalid email or password.');
    }
    resetCaptcha('login');
    setButtonLoading(loginBtn, false);
    return;
  }
  
  // ✅ Atualizar timestamp de última atividade
  updateLastActivity();
  
  // Salvar aceitação dos termos e atualizar email
  if (data?.user) {
    try {
      const { data: stats } = await supabase
        .from('player_stats')
        .select('username, email')
        .eq('user_id', data.user.id)
        .single();
      
      if (stats) {
        // Salvar aceitação dos termos
        await supabase
          .from('terms_acceptance')
          .upsert({
            user_id: data.user.id,
            username: stats.username,
            email: data.user.email,
            accepted_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
        
        // Atualizar email no player_stats se não existir
        if (!stats.email) {
          await supabase
            .from('player_stats')
            .update({ email: data.user.email })
            .eq('user_id', data.user.id);
        }
      }
    } catch (err) {
      console.error('Error saving terms acceptance:', err);
    }
  }
  
  // 🔥 Toast de sucesso
  showToast('success', 'Welcome Back! 👋', 'Login successful!');
  setButtonLoading(loginBtn, false);
  resetCaptcha('login');
  
  // 🛡️ Buscar token CSRF após login bem-sucedido
  if (data?.user && data.session?.access_token) {
    try {
      await fetchCsrfToken(data.user.id, data.session.access_token);
      console.log('✅ CSRF token obtained');
    } catch (err) {
      console.error('Failed to fetch CSRF token:', err);
      // Não bloqueia o login se falhar, apenas registra o erro
    }
  }
  
  // O onAuthStateChange irá carregar os dados do usuário
}

/**
 * Realiza o registro de um novo usuário
 */
export async function handleRegister(): Promise<void> {
  const usernameEl = document.getElementById('register-username');
  const emailEl = document.getElementById('register-email');
  const passwordEl = document.getElementById('register-password');
  const confirmEl = document.getElementById('register-confirm');
  const referralEl = document.getElementById('register-referral-code');
  const termsEl = document.getElementById('register-terms-accept');
  const errorEl = document.getElementById('register-error');
  const registerBtn = document.querySelector('#register-form button');
  if (!usernameEl || !emailEl || !passwordEl || !confirmEl || !errorEl) return;

  const username = usernameEl.value;
  const email = emailEl.value;
  const password = passwordEl.value;
  const confirm = confirmEl.value;
  const referralCode = referralEl?.value?.trim() || '';
  const captchaToken = CAPTCHA_REQUIRED ? registerCaptchaToken : null;

  errorEl.textContent = '';
  setButtonLoading(registerBtn, true);
  
  if (!username || !email || !password || !confirm) {
    errorEl.textContent = 'Complete all the fields';
    showAlert('warning', 'Missing Fields! ⚠️', 'Please fill in all registration fields.');
    setButtonLoading(registerBtn, false);
    return;
  }

  if (!termsEl?.checked) {
    errorEl.textContent = 'You must accept the Terms of Use and Privacy Policy to continue.';
    showAlert('warning', 'Terms Required! 📜', 'Please accept the Terms of Use and Privacy Policy to create your account.');
    setButtonLoading(registerBtn, false);
    return;
  }

  if (CAPTCHA_REQUIRED && !captchaToken) {
    errorEl.textContent = 'Complete the captcha before signing up.';
    showAlert('warning', 'Captcha Required', 'Please complete the captcha to continue.');
    setButtonLoading(registerBtn, false);
    return;
  }
  
  if (password !== confirm) {
    errorEl.textContent = 'The passwords dont match.';
    showAlert('error', 'Password Mismatch! ❌', 'Passwords do not match. Please try again.');
    setButtonLoading(registerBtn, false);
    return;
  }
  
  if (password.length < 6) {
    errorEl.textContent = 'The password must be at least 6 characters long.';
    showAlert('warning', 'Weak Password! ⚠️', 'Password must be at least 6 characters long.');
    setButtonLoading(registerBtn, false);
    return;
  }
  
  try {
    const { data: authData, error: authError } = await supabase.auth.signUp({ 
      email, 
      password,
      options: {
        emailRedirectTo: window.location.origin,
        captchaToken: captchaToken || undefined
      }
    });
    
    if (authError) {
      errorEl.textContent = authError.message;
      showAlert('error', 'Registration Failed! ❌', authError.message || 'Unable to create account.');
      setButtonLoading(registerBtn, false);
      return;
    }
    
    if (!authData.user) {
      errorEl.textContent = 'Error creating account';
      showAlert('error', 'Registration Failed! ❌', 'Unable to create account. Please try again.');
      setButtonLoading(registerBtn, false);
      return;
    }
    
    // Usar upsert para evitar conflito se o usuário já existir
    const { error: dbError } = await supabase
      .from('player_stats')
      .upsert({
        user_id: authData.user.id,
        username: username,
        email: email,
        money: 10,
        diamonds: 0,
        level: 1,
        xp: 0,
        total_wins: 0,
        total_battles: 0
      }, {
        onConflict: 'user_id'
      });
    
    if (dbError) {
      console.error('Error creating profile:', dbError);
      errorEl.textContent = 'Error creating profile: ' + dbError.message;
      showAlert('error', 'Profile Error! ❌', 'Account created but profile setup failed. Contact support.');
      setButtonLoading(registerBtn, false);
      return;
    }

    // Salvar aceitação dos termos
    try {
      await supabase
        .from('terms_acceptance')
        .upsert({
          user_id: authData.user.id,
          username: username,
          email: email,
          accepted_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });
    } catch (termsError) {
      console.error('Error saving terms acceptance:', termsError);
    }

    if (referralCode) {
      storePendingReferral(referralCode, authData.user.id);
      if (authData.session?.access_token) {
        await attemptReferralLink(referralCode, authData.user.id, authData.session.access_token);
      }
    }
    
    errorEl.className = 'auth-success';
    errorEl.textContent = '✅ Registration complete! Check your email to activate your account.';
    
    // 🔥 Alert grande e visível sobre email
    showAlert('success', '🎉 Account Created Successfully!', 
      `A confirmation email has been sent to ${email}. \n\nPlease check your email (including spam folder) and click the confirmation link to activate your account. You must verify your email before you can log in.`,
      { duration: 0 }
    );
    
    usernameEl.value = '';
    emailEl.value = '';
    passwordEl.value = '';
    confirmEl.value = '';
    if (referralEl) referralEl.value = '';
    resetCaptcha('register');
    setButtonLoading(registerBtn, false);
    
  } catch (err) {
    console.error('Error in registration:', err);
    errorEl.textContent = 'Unexpected error while creating account.';
    showAlert('error', 'Unexpected Error! 🌐', 'Something went wrong. Please try again later.');
    resetCaptcha('register');
    setButtonLoading(registerBtn, false);
  }
}

/**
 * Realiza o logout do usuário
 * @param {boolean} isInBattle - Se o usuário está em uma batalha
 */
export async function handleLogout(isInBattle: boolean = false): Promise<void> {
  if (isInBattle) {
    const confirmar = confirm('⚠️ You are in a battle! Do you really want to walk away and lose your investment?');
    if (!confirmar) return;
  }
  
  // ✅ Limpar chat ANTES de fazer signOut
  if (window.cleanupChat) {
    window.cleanupChat();
  }

  if (window.cleanupFriends) {
    window.cleanupFriends();
  }
  
  // 🛡️ Limpar token CSRF do servidor e localstorage
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await clearCsrfTokenOnServer(session.user.id, session.access_token);
      console.log('✅ CSRF token cleared');
    }
  } catch (err) {
    console.error('Failed to clear CSRF token:', err);
    // Não bloqueia o logout se falhar
  }
  
  // ✅ Limpar variáveis globais ANTES de fazer signOut
  clearActiveUser();

  // Zera sem exibir popups
  window.__suppressCurrencyPopups = true;
  try {
    if (window.playerMoney) window.playerMoney.value = 0;
    if (window.playerDiamonds) window.playerDiamonds.value = 0;
  } finally {
    window.__suppressCurrencyPopups = false;
  }

  if (window.invalidateAdminRoleCache) {
    window.invalidateAdminRoleCache();
  }
  
  // Limpar localStorage
  localStorage.removeItem('appState');
  
  // Limpar Redux store (auth já foi limpo pelo clearActiveUser)
  store.dispatch(dataActions.clearAllData());
  
  // ✅ Fazer signOut por último
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error('Error signing out:', err);
  }
  
  // Redirecionar para tela de auth com URL
  window.history.pushState({}, '', '/auth');
  
  if (window.goTo) {
    window.goTo('auth-screen');
  }
  
  // Verificar rota após logout
  if (window.checkRouteAuth) {
    setTimeout(() => window.checkRouteAuth(), 100);
  }
  
  // Não usar reload - deixar o onAuthStateChange cuidar da limpeza
}

/**
 * Carrega os dados do usuário após o login
 * @param {Object} user - Objeto do usuário do Supabase
 * @param {Function} updateMoneyDisplay - Função para atualizar o display de dinheiro
 * @param {Function} calculateLevel - Função para calcular o nível
 * @param {Function} loadSavedColors - Função para carregar cores salvas
 * @param {Function} checkAndShowAdminButton - Função para verificar admin
 * @param {Function} applyTranslations - Função para aplicar traduções
 * @param {Function} goTo - Função para navegar entre telas
 */
export async function loadUserData(
  user: User, 
  updateMoneyDisplay?: () => void,
  calculateLevel?: (xp: number) => any,
  loadSavedColors?: () => void,
  checkAndShowAdminButton?: () => Promise<void>,
  applyTranslations?: () => void,
  goTo?: (screen: string) => void
): Promise<void> {
  // Fonte única: sincroniza window + Redux
  setActiveUser(user, { persist: false });
  try {
    await syncPendingReferral(user);
  } catch (err) {
    console.warn('Pending referral sync failed', err?.message || err);
  }
  
  const { data, error } = await supabase
    .from('player_stats')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  if (error || !data) {
    console.error('Error loading data:', error);
    return;
  }
  
  // ✅ DETECTAR SE JÁ É PROXY OU NÚMERO SIMPLES (sem popups)
  window.__suppressCurrencyPopups = true;
  try {
    if (window.playerMoney) window.playerMoney.value = data.money || 0;
    if (window.playerDiamonds) window.playerDiamonds.value = data.diamonds || 0;
    // Cache local para rotas evitarem refetch de passes
    window.cachedUnlockedPasses = Array.isArray(data.unlocked_passes)
      ? data.unlocked_passes
      : [];
    window.cachedDiamonds = data.diamonds || 0;
    window.cachedCaseDiscountLevel = Math.max(0, Number(data.case_discount_level) || 0);
  } finally {
    window.__suppressCurrencyPopups = false;
  }
  
  // Atualizar UI imediatamente
  if (updateMoneyDisplay) updateMoneyDisplay();
  const usernameDisplay = document.getElementById('username-display');
  const userLevelEl = document.getElementById('user-level');
  if (usernameDisplay) usernameDisplay.textContent = data.username;
  if (userLevelEl) userLevelEl.textContent = String(data.level);
  
  // Mostrar tela principal imediatamente
  const authScreen = document.getElementById('auth-screen');
  const header = document.getElementById('header');
  if (authScreen) authScreen.classList.remove('active');
  if (header) header.classList.remove('hidden');
  
  // NÃO forçar menu - deixar o router gerenciar baseado na URL atual
  // if (!window.willRestoreState && goTo) {
  //   goTo('menu');
  // }
  
  // Verificar rota após login (router vai mostrar a tela correta baseado na URL)
  if (window.checkRouteAuth) {
    setTimeout(() => window.checkRouteAuth(), 100);
  } else if (window.location.pathname === '/auth' && goTo) {
    // Se ainda estiver em /auth após login, ir para menu
    goTo('menu');
  }
  
  // ⭐ USAR SISTEMA QUADRÁTICO (não bloqueia)
  if (calculateLevel) {
    const levelInfo = calculateLevel(data.xp || 0);
    const xpProgress = (levelInfo.currentXP / levelInfo.nextLevelXP) * 100;

    // Atualizar XP Progress
    const xpBar = document.getElementById('xp-bar-fill');
    const xpText = document.getElementById('user-xp');

    if (xpText) xpText.textContent = `${levelInfo.currentXP}/${levelInfo.nextLevelXP} XP`;

    // Animar barra de XP
    if (xpBar) {
      xpBar.style.transition = 'width 0.5s ease';
      xpBar.style.width = xpProgress + '%';
    }
    if (userLevelEl) userLevelEl.textContent = String(levelInfo.level);
  }
  
  // Atualizar avatar no header
  const headerAvatar = document.getElementById('header-avatar');
  const menuAvatar = document.getElementById('menu-avatar');
  const cacheBust = Date.now();
  if (headerAvatar) {
    if (data.avatar_url) {
      headerAvatar.src = data.avatar_url + '?t=' + cacheBust;
    } else {
      const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`;
      headerAvatar.src = avatarUrl;
    }
  }
  if (menuAvatar) {
    if (data.avatar_url) {
      menuAvatar.src = data.avatar_url + '?t=' + cacheBust;
    } else {
      const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`;
      menuAvatar.src = avatarUrl;
    }
  }

  // Operações que podem ser lentas - executar em paralelo sem await
  Promise.all([
    loadSavedColors ? Promise.resolve(loadSavedColors()) : Promise.resolve(),
    checkAndShowAdminButton ? checkAndShowAdminButton() : Promise.resolve(),
    applyTranslations ? Promise.resolve(applyTranslations()) : Promise.resolve(),
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.access_token) {
        await fetchCsrfToken(user.id, sessionData.session.access_token);
      }
    })().catch(err => console.error('Error fetching CSRF token:', err))
  ]).catch(err => console.error('Error loading secondary data:', err));
}

/**
 * Configura o listener de mudanças de estado de autenticação
 * @param {Function} loadUserDataCallback - Callback para carregar dados do usuário
 */
export function setupAuthStateListener(loadUserDataCallback: (user: User) => void): void {
  // Evitar múltiplos listeners (hot reload / chamadas repetidas)
  if (authStateSubscription) {
    try {
      authStateSubscription.unsubscribe();
    } catch {
      // ignore
    }
    authStateSubscription = null;
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') {
      return;
    }

    // Em refresh com sessão persistida, Supabase dispara INITIAL_SESSION
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
      // 🔒 Verificar se precisa forçar relogin por inatividade (3 dias)
      if (shouldForceRelogin()) {
        console.log('[AUTH] Forçando relogin por inatividade de 3 dias');
        supabase.auth.signOut();
        clearSessionData();
        clearActiveUser();
        showAlert('info', '🔐 Sessão Expirada', 'Sua sessão expirou por inatividade. Por favor, faça login novamente.');
        return;
      }
      
      // ✅ Atualizar timestamp de atividade
      updateLastActivity();
      
      loadUserDataCallback(session.user);
      return;
    }

    if (event === 'SIGNED_OUT') {
      // ✅ LIMPAR CHAT PRIMEIRO
      if (window.cleanupChat) {
        window.cleanupChat();
      }

      // ✅ FECHAR E RESETAR PAINEL DO CHAT
      const chatPanel = document.getElementById('chat-panel');
      const chatBtn = document.getElementById('chat-toggle-icon');
      
      if (chatPanel) {
        chatPanel.classList.remove('active');
      }
      
      if (chatBtn) {
        chatBtn.classList.remove('active');
        if (typeof window.setChatToggleIcon === 'function') {
          window.setChatToggleIcon({ count: '0', icon: 'messages-square', showCount: true });
        } else {
          chatBtn.innerHTML = '<span class="header-icon" data-lucide="messages-square"></span><span class="chat-online-count" id="chat-online-count">0</span>';
          if (typeof window.refreshLucideIcons === 'function') {
            window.refreshLucideIcons();
          }
        }
      }

      // Limpar variáveis
      clearActiveUser();
      window.__suppressCurrencyPopups = true;
      try {
        if (window.playerMoney) window.playerMoney.value = 0;
        if (window.playerDiamonds) window.playerDiamonds.value = 0;
      } finally {
        window.__suppressCurrencyPopups = false;
      }
      if (window.invalidateAdminRoleCache) window.invalidateAdminRoleCache();
      
      // Limpar Redux/data
      store.dispatch(dataActions.clearAllData());
      
      // Esconder todas as telas
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      
      // Mostrar tela de auth com o formulário de login
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) {
        authScreen.classList.add('active');
      }
      
      // Garantir que o formulário de login está visível
      const loginForm = document.getElementById('login-form');
      const registerForm = document.getElementById('register-form');
      if (loginForm) loginForm.classList.remove('hidden');
      if (registerForm) registerForm.classList.add('hidden');
      
      // Garantir que o header está escondido
      const header = document.getElementById('header');
      if (header) header.classList.add('hidden');
      
      // Verificar rota após estado de não autenticado
      if (window.checkRouteAuth) {
        setTimeout(() => window.checkRouteAuth(), 100);
      }
      
      // Ativar a tab de login
      const tabs = document.querySelectorAll('.auth-tab');
      if (tabs.length >= 2) {
        tabs[0].classList.add('active');
        tabs[1].classList.remove('active');
      }
      
      // 🔥 Toast de logout
      showToast('info', 'Logged Out! 👋', 'See you soon!');
    }
  });

  authStateSubscription = data?.subscription || null;
}

// ============================================================
// 🛡️ TWO-FACTOR AUTHENTICATION (2FA)
// ============================================================

/**
 * Solicita setup de 2FA e exibe o QR code para o usuário
 * @param userId - ID do usuário
 * @param authToken - Token de autenticação
 */
export async function requestSetup2FA(userId: string, authToken: string): Promise<{ secret: string; qrCode: string } | null> {
  try {
    const response = await fetch('/api/_profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': (window as any).currentCsrfToken || ''
      },
      body: JSON.stringify({
        action: 'setup2FA',
        userId,
        authToken
      })
    });

    if (!response.ok) {
      console.error('Failed to setup 2FA:', response.status);
      showAlert('error', '❌ 2FA Setup Failed', 'Could not generate 2FA secret');
      return null;
    }

    const data = await response.json();
    if (data.success && data.secret && data.qrCode) {
      return { secret: data.secret, qrCode: data.qrCode };
    }

    return null;
  } catch (error) {
    console.error('Error requesting 2FA setup:', error);
    showAlert('error', '❌ Error', 'Failed to setup 2FA');
    return null;
  }
}

/**
 * Verifica o código 2FA e ativa 2FA para o usuário
 * @param userId - ID do usuário
 * @param authToken - Token de autenticação
 * @param secret - Secret 2FA compartilhado
 * @param code - Código 6-dígito do autenticador
 */
export async function verifyAndEnable2FA(userId: string, authToken: string, secret: string, code: string): Promise<boolean> {
  try {
    // Validar formato do código
    if (!/^\d{6}$/.test(code)) {
      showAlert('warning', '⚠️ Invalid Code', 'Please enter a valid 6-digit code');
      return false;
    }

    const response = await fetch('/api/_profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': (window as any).currentCsrfToken || ''
      },
      body: JSON.stringify({
        action: 'verify2FA',
        userId,
        authToken,
        secret,
        code
      })
    });

    if (!response.ok) {
      console.error('Failed to verify 2FA:', response.status);
      const errorData = await response.json();
      showAlert('error', '❌ Verification Failed', errorData.error || 'Invalid code');
      return false;
    }

    const data = await response.json();
    if (data.success) {
      showToast('success', '✅ 2FA Enabled', '2FA has been enabled on your account');
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error verifying 2FA:', error);
    showAlert('error', '❌ Error', 'Failed to verify 2FA code');
    return false;
  }
}

/**
 * Desabilita 2FA usando um código de autenticação válido
 * @param userId - ID do usuário
 * @param authToken - Token de autenticação
 * @param code - Código 6-dígito do autenticador
 */
export async function disable2FA(userId: string, authToken: string, code: string): Promise<boolean> {
  try {
    // Validar formato do código
    if (!/^\d{6}$/.test(code)) {
      showAlert('warning', '⚠️ Invalid Code', 'Please enter a valid 6-digit code');
      return false;
    }

    const response = await fetch('/api/_profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': (window as any).currentCsrfToken || ''
      },
      body: JSON.stringify({
        action: 'disable2FA',
        userId,
        authToken,
        code
      })
    });

    if (!response.ok) {
      console.error('Failed to disable 2FA:', response.status);
      const errorData = await response.json();
      showAlert('error', '❌ Failed', errorData.error || 'Invalid code');
      return false;
    }

    const data = await response.json();
    if (data.success) {
      showToast('success', '✅ 2FA Disabled', '2FA has been removed from your account');
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    showAlert('error', '❌ Error', 'Failed to disable 2FA');
    return false;
  }
}

/**
 * Prompts the user to enter a 2FA code during login
 * @returns 6-digit 2FA code or null if cancelled
 */
export function prompt2FACode(): Promise<string | null> {
  return new Promise((resolve) => {
    // Criar modal para entrada de código 2FA
    const modal = document.createElement('div');
    modal.id = '2fa-modal';
    modal.className = 'modal modal-2fa';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <h2>Two-Factor Authentication</h2>
        <p>Enter the 6-digit code from your authenticator app:</p>
        <input 
          type="text" 
          id="2fa-code-input" 
          maxlength="6" 
          placeholder="000000" 
          inputmode="numeric"
          autocomplete="off"
        />
        <div class="modal-actions">
          <button id="2fa-verify-btn" class="btn btn-primary">Verify</button>
          <button id="2fa-cancel-btn" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    const codeInput = document.getElementById('2fa-code-input') as HTMLInputElement;
    const verifyBtn = document.getElementById('2fa-verify-btn');
    const cancelBtn = document.getElementById('2fa-cancel-btn');
    
    codeInput?.focus();
    
    const cleanup = () => {
      modal.remove();
    };
    
    const handleVerify = () => {
      const code = codeInput?.value.trim();
      if (code && /^\d{6}$/.test(code)) {
        cleanup();
        resolve(code);
      } else {
        showAlert('warning', '⚠️ Invalid Code', 'Please enter a valid 6-digit code');
      }
    };
    
    const handleCancel = () => {
      cleanup();
      resolve(null);
    };
    
    verifyBtn?.addEventListener('click', handleVerify);
    cancelBtn?.addEventListener('click', handleCancel);
    codeInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleVerify();
    });
  });
}

function initializeAuthUI(): void {
  hydrateAuthForm();
  prefillReferralFromUrl();
  detectPasswordReset();
  renderHCaptcha();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAuthUI, { once: true });
} else {
  initializeAuthUI();
}

// 🌍 Expor funções para o escopo global (HTML onclick)
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handlePasswordReset = handlePasswordReset;
window.handleUpdatePassword = handleUpdatePassword;
window.updatePasswordAfterReset = updatePasswordAfterReset;
window.requestSetup2FA = requestSetup2FA;
window.verifyAndEnable2FA = verifyAndEnable2FA;
window.disable2FA = disable2FA;
window.prompt2FACode = prompt2FACode;
