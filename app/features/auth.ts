// ============================================================
// AUTH.JS - Sistema de Autenticação
// ============================================================

import { createClient, Session, User, AuthError } from '@supabase/supabase-js';
import { showToast, showAlert } from '../shared/effects';
import { store, authActions, dataActions } from '../core/persistence';
import { clearActiveUser, setActiveUser, fetchCsrfToken, clearCsrfTokenOnServer, getActiveUser, isCsrfTokenValid } from '../core/session';
import { Validation } from '../shared/validation';
import { ErrorHandler, ErrorCategory, ErrorSeverity, tryCatch } from '../shared/error-handler';
import { initPasswordStrengthIndicators } from '../shared/password-strength-ui';
import { stateManager } from '../core/state-manager';

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
    checkRouteAuth?: () => void;
    goTo?: (screen: string) => void;
    refreshLucideIcons?: () => void;
    handleLogin: typeof handleLogin;
    handleRegister: typeof handleRegister;
    handlePasswordReset: typeof handlePasswordReset;
    handleUpdatePassword: typeof handleUpdatePassword;
    updatePasswordAfterReset: typeof updatePasswordAfterReset;
  }
}

// ============ SUPABASE CONFIG ============
const SUPABASE_URL = 'https://xgcseugigsdgmyrfrofj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnY3NldWdpZ3NkZ215cmZyb2ZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM3NzAwNjcsImV4cCI6MjA3OTM0NjA2N30.lzDmtmxi1D88MihkfSBnHeHpyfiqeo9C5XDqshQNOso';
const PENDING_REFERRAL_KEY = 'pending-referral-link';
// Vite substitui import.meta.env em build; fallback para window.* caso seja injetado manualmente
const HCAPTCHA_SITEKEY = (globalThis as any).VITE_HCAPTCHA_SITEKEY
  || (window as any).HCAPTCHA_SITEKEY
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

// ============================================================
// CSRF HELPERS
// ============================================================

async function ensureCsrfForSession(session: Session | null): Promise<void> {
  if (!session?.user || !session.access_token) return;
  // Mantém o token atual se ainda for válido (evita troca desnecessária)
  if (await isCsrfTokenValid(session.user.id)) return;
  try {
    await fetchCsrfToken(session.user.id, session.access_token);
  } catch (err) {
    ErrorHandler.handleError('Failed to refresh CSRF token', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
  }
}

// ============ HELPERS ============

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
    script.onload = () => resolve(window.hcaptcha!);
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
  const emailEl = document.getElementById('login-email') as HTMLInputElement | null;
  const errorEl = document.getElementById('login-error');
  
  if (!emailEl?.value?.trim()) {
    ErrorHandler.handleValidationError(
      'Empty email in password reset',
      {},
      'Please enter your email address to reset your password.'
    );
    return;
  }

  const email = emailEl.value.trim();
  
  // ✅ Validar formato de email
  if (!Validation.email.isValid(email)) {
    ErrorHandler.handleValidationError(
      'Invalid email format in password reset',
      { email },
      'Please enter a valid email address.'
    );
    return;
  }
  
  const captchaToken = CAPTCHA_REQUIRED ? loginCaptchaToken : null;
  
  if (CAPTCHA_REQUIRED && !captchaToken) {
    if (errorEl) errorEl.textContent = 'Complete the captcha before sending reset link.';
    ErrorHandler.handleValidationError(
      'Missing captcha in password reset',
      {},
      'Please complete the captcha to continue.'
    );
    return;
  }

  try {
    // URLs de redirect permitidas - hardcoded para evitar phishing
    const allowedRedirectDomains = [
      'https://lootskirmish.vercel.app',
      'https://www.lootskirmish.com',
      'http://localhost:5173' // desenvolvimento
    ];
    const currentOrigin = window.location.origin;
    
    // Validar se o domínio atual está na lista permitida
    if (!allowedRedirectDomains.includes(currentOrigin)) {
      ErrorHandler.handleError('Potential phishing attack detected', {
        category: ErrorCategory.PERMISSION,
        severity: ErrorSeverity.CRITICAL,
        details: { currentOrigin },
        userMessage: 'Invalid redirect domain. Contact support.',
        showToUser: true
      });
      return;
    }
    
    const result = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${currentOrigin}/auth?reset=true`,
      captchaToken: captchaToken || undefined
    });
    const { error, data } = result;
    
    if (error) {
      ErrorHandler.handleAuthError(
        'Password reset failed',
        { error: error.message, email },
        error.message || 'Unable to send reset email.'
      );
      resetCaptcha('login');
      return;
    }

    showAlert('success', 'Check Your Email! 📧', 'Password reset link sent. Check your email to continue.');
    if (errorEl) {
      errorEl.textContent = 'Password reset link sent to your email!';
      errorEl.className = 'auth-success';
    }
    resetCaptcha('login');
  } catch (err) {
    ErrorHandler.handleError('Password reset unexpected error', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      userMessage: 'Something went wrong. Please try again.',
      showToUser: true
    });
  }
}

export async function updatePasswordAfterReset(newPassword: string): Promise<boolean> {
  if (!newPassword?.trim()) {
    ErrorHandler.handleValidationError(
      'Empty password in password update',
      {},
      'Please enter a new password.'
    );
    return false;
  }
  
  // ✅ Validar força da senha
  const strength = Validation.password.checkStrength(newPassword);
  if (strength.score < 2) {
    ErrorHandler.handleValidationError(
      'Weak password in password update',
      { score: strength.score, feedback: strength.feedback },
      `Password is too weak. ${strength.feedback[0] || 'Use a stronger password.'}`
    );
    return false;
  }
  
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  
  if (error) {
    ErrorHandler.handleAuthError(
      'Password update failed',
      { error: error.message },
      error.message || 'Unable to update password.'
    );
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
  const newPasswordEl = document.getElementById('reset-new-password') as HTMLInputElement | null;
  const confirmPasswordEl = document.getElementById('reset-confirm-password') as HTMLInputElement | null;
  const errorEl = document.getElementById('reset-error');
  
  if (!newPasswordEl || !confirmPasswordEl || !errorEl) return;
  
  const newPassword = (newPasswordEl as HTMLInputElement).value.trim();
  const confirmPassword = (confirmPasswordEl as HTMLInputElement).value.trim();
  
  errorEl.textContent = '';
  
  if (!newPassword || !confirmPassword) {
    errorEl.textContent = 'Please fill in both fields';
    ErrorHandler.handleValidationError(
      'Missing password fields',
      {},
      'Enter your new password twice.'
    );
    return;
  }
  
  if (newPassword !== confirmPassword) {
    errorEl.textContent = 'Passwords do not match';
    ErrorHandler.handleValidationError(
      'Passwords mismatch',
      {},
      'Make sure both passwords are the same.'
    );
    return;
  }
  
  // ✅ Validar força da senha
  const strength = Validation.password.checkStrength(newPassword);
  if (strength.score < 2) {
    errorEl.textContent = `Password too weak: ${strength.label}`;
    ErrorHandler.handleValidationError(
      'Weak password',
      { score: strength.score, feedback: strength.feedback },
      `Password is too weak (${strength.label}). ${strength.feedback[0] || 'Use a stronger password.'}`
    );
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
  }
}

/**
 * Reenvia email de confirmação com rate limiting (máx 3x a cada 60s)
 */
export async function resendConfirmationEmail(email: string): Promise<boolean> {
  try {
    // Rate limiting - armazenar em sessionStorage
    const rateLimitKey = `resend_email_${email}`;
    const lastAttempt = sessionStorage.getItem(rateLimitKey);
    const now = Date.now();
    
    if (lastAttempt) {
      const timeSinceLastAttempt = now - parseInt(lastAttempt);
      const retryAfter = 60000; // 60 segundos
      
      if (timeSinceLastAttempt < retryAfter) {
        const secondsLeft = Math.ceil((retryAfter - timeSinceLastAttempt) / 1000);
        showAlert('warning', '⏱️ Please Wait', `Try again in ${secondsLeft} seconds`);
        return false;
      }
    }
    
    // Atualizar timestamp
    sessionStorage.setItem(rateLimitKey, now.toString());
    
    // URLs de redirect permitidas - hardcoded
    const allowedRedirectDomains = [
      'https://lootskirmish.vercel.app',
      'https://www.lootskirmish.com',
      'http://localhost:5173'
    ];
    
    const currentOrigin = window.location.origin;
    if (!allowedRedirectDomains.includes(currentOrigin)) {
      ErrorHandler.handleError('Potential phishing attack detected', {
        category: ErrorCategory.PERMISSION,
        severity: ErrorSeverity.CRITICAL,
        details: { currentOrigin },
        userMessage: 'Invalid redirect domain.',
        showToUser: true
      });
      return false;
    }
    
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${currentOrigin}/auth?confirmed=true`
      }
    });
    
    if (error) {
      ErrorHandler.handleAuthError(
        'Resend email failed',
        { error: error.message },
        error.message || 'Unable to resend confirmation email'
      );
      return false;
    }
    
    showToast('success', '📧 Sent!', 'Confirmation email sent. Check your inbox (including spam).');
    return true;
  } catch (error) {
    ErrorHandler.handleNetworkError(
      'Error resending email',
      { error }
    );
    return false;
  }
}


async function checkEmailVerification(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  
  const isEmailConfirmed = session.user.email_confirmed_at !== null && session.user.email_confirmed_at !== undefined;
  
  if (!isEmailConfirmed) {
    // Email não confirmado - mostrar modal grande e visível COM opção de reenvio
    const userEmail = session.user.email || 'your email';
    showAlert('warning', '📧 Email Not Verified!', 
      `Please check your email and click the confirmation link to activate your account. You may need to check your spam folder.\n\n📬 Didn't receive it?`,
      { duration: 0 } as any
    );
    
    // Adicionar botão de reenvio após um breve delay
    setTimeout(() => {
      const alertButtons = document.querySelectorAll('.alert-action-btn');
      const resendBtn = document.createElement('button');
      resendBtn.className = 'alert-action-btn resend-btn';
      resendBtn.textContent = 'Resend Email';
      resendBtn.style.marginTop = '10px';
      resendBtn.onclick = async () => {
        await resendConfirmationEmail(userEmail);
      };
      
      const alertBox = document.querySelector('.alert-box');
      if (alertBox) {
        alertBox.appendChild(resendBtn);
      }
    }, 500);
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
    
    const input = document.getElementById('register-referral-code') as HTMLInputElement | null;
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
    console.warn('referral linking failed', (err as any)?.message || err);
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
      if (btn && btn instanceof HTMLButtonElement) {
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
        callback: (token: string) => { loginCaptchaToken = token; },
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
        callback: (token: string) => { registerCaptchaToken = token; },
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
  const emailEl = document.getElementById('login-email') as HTMLInputElement | null;
  const passwordEl = document.getElementById('login-password') as HTMLInputElement | null;
  const errorEl = document.getElementById('login-error');
  const termsEl = document.getElementById('login-terms-accept') as HTMLInputElement | null;
  const loginBtn = document.querySelector('#login-form button') as HTMLButtonElement | null;
  if (!emailEl || !passwordEl || !errorEl) return;

  const email = (emailEl as HTMLInputElement).value.trim();
  const password = (passwordEl as HTMLInputElement).value;
  const termsAccepted = !!(termsEl as HTMLInputElement)?.checked;
  const captchaToken = CAPTCHA_REQUIRED ? loginCaptchaToken : null;

  errorEl.textContent = '';
  setButtonLoading(loginBtn as HTMLButtonElement | null, true);
  
  // ✅ Validação básica
  if (!email || !password) {
    errorEl.textContent = 'Complete all the fields';
    ErrorHandler.handleValidationError('Missing login fields', null, 'Please fill in your email and password.');
    setButtonLoading(loginBtn, false);
    return;
  }

  // ✅ Validação de formato de email
  if (!Validation.email.isValid(email)) {
    errorEl.textContent = 'Invalid email format';
    ErrorHandler.handleValidationError('Invalid email format', { email }, 'Please enter a valid email address.');
    setButtonLoading(loginBtn, false);
    return;
  }

  // ✅ Validação de senha mínima
  if (!Validation.password.isValid(password, 6)) {
    errorEl.textContent = 'Password must be at least 6 characters';
    ErrorHandler.handleValidationError('Password too short', null, 'Password must be at least 6 characters long.');
    setButtonLoading(loginBtn, false);
    return;
  }

  if (!termsAccepted) {
    errorEl.textContent = 'You must agree to the Terms and Privacy Policy';
    ErrorHandler.handleValidationError('Terms not accepted', null, 'Please accept the Terms of Use and Privacy Policy to continue.');
    setButtonLoading(loginBtn, false);
    return;
  }

  // ✅ Rate limiting
  const rateLimit = Validation.rateLimit.check('login', 5, 60000); // 5 tentativas por minuto
  if (!rateLimit.allowed) {
    const waitTime = Math.ceil(rateLimit.resetIn / 1000);
    errorEl.textContent = `Too many login attempts. Wait ${waitTime}s`;
    ErrorHandler.handleValidationError(
      'Login rate limit exceeded',
      { remainingAttempts: rateLimit.remainingAttempts },
      `Too many login attempts. Please wait ${waitTime} seconds before trying again.`
    );
    setButtonLoading(loginBtn, false);
    return;
  }

  if (CAPTCHA_REQUIRED && !captchaToken) {
    errorEl.textContent = 'Complete the captcha before logging in.';
    ErrorHandler.handleValidationError('Captcha required', null, 'Please complete the captcha to continue.');
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

  if (error) {
    // Se o erro for que email não foi verificado, mostrar mensagem específica
    const isEmailNotVerified = error.message?.includes('Email not confirmed') || 
                              error.status === 403;
    
    if (isEmailNotVerified) {
      errorEl.textContent = 'Please verify your email before logging in.';
      ErrorHandler.handleAuthError(
        'Login failed - email not verified',
        { error: error.message },
        'You must confirm your email before logging in. Check your email (including spam folder) for the confirmation link.'
      );
    } else {
      errorEl.textContent = error.message;
      ErrorHandler.handleAuthError(
        'Login failed',
        { error: error.message, email },
        error.message || 'Invalid email or password.'
      );
    }
    resetCaptcha('login');
    setButtonLoading(loginBtn, false);
    return;
  }
  
  // ✅ Sucesso - resetar rate limit
  Validation.rateLimit.reset('login');
  
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
      ErrorHandler.handleError('Failed to save terms acceptance', {
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.WARNING,
        details: err,
        showToUser: false
      });
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
    } catch (err) {
      ErrorHandler.handleError('Failed to fetch CSRF token after login', {
        category: ErrorCategory.AUTH,
        severity: ErrorSeverity.WARNING,
        details: err,
        showToUser: false
      });
      // Não bloqueia o login se falhar, apenas registra o erro
    }
  }
  
  // O onAuthStateChange irá carregar os dados do usuário
}

/**
 * Realiza o registro de um novo usuário
 */
export async function handleRegister(): Promise<void> {
  const usernameEl = document.getElementById('register-username') as HTMLInputElement | null;
  const emailEl = document.getElementById('register-email') as HTMLInputElement | null;
  const passwordEl = document.getElementById('register-password') as HTMLInputElement | null;
  const confirmEl = document.getElementById('register-confirm') as HTMLInputElement | null;
  const referralEl = document.getElementById('register-referral-code') as HTMLInputElement | null;
  const termsEl = document.getElementById('register-terms-accept') as HTMLInputElement | null;
  const errorEl = document.getElementById('register-error');
  const registerBtn = document.querySelector('#register-form button') as HTMLButtonElement | null;
  if (!usernameEl || !emailEl || !passwordEl || !confirmEl || !errorEl) return;

  const username = (usernameEl as HTMLInputElement).value.trim();
  const email = (emailEl as HTMLInputElement).value.trim();
  const password = (passwordEl as HTMLInputElement).value;
  const confirm = (confirmEl as HTMLInputElement).value;
  const referralCode = (referralEl as HTMLInputElement)?.value?.trim() || '';
  const captchaToken = CAPTCHA_REQUIRED ? registerCaptchaToken : null;

  errorEl.textContent = '';
  setButtonLoading(registerBtn as HTMLButtonElement | null, true);
  
  // ✅ Validação básica
  if (!username || !email || !password || !confirm) {
    errorEl.textContent = 'Complete all the fields';
    ErrorHandler.handleValidationError('Missing registration fields', null, 'Please fill in all registration fields.');
    setButtonLoading(registerBtn, false);
    return;
  }

  if (!(termsEl as HTMLInputElement)?.checked) {
    errorEl.textContent = 'You must accept the Terms of Use and Privacy Policy to continue.';
    ErrorHandler.handleValidationError('Terms not accepted', null, 'Please accept the Terms of Use and Privacy Policy to create your account.');
    setButtonLoading(registerBtn, false);
    return;
  }

  // ✅ Rate limiting para registro
  const rateLimit = Validation.rateLimit.check('register', 3, 300000); // 3 tentativas em 5 minutos
  if (!rateLimit.allowed) {
    const waitTime = Math.ceil(rateLimit.resetIn / 1000);
    errorEl.textContent = `Too many registration attempts. Wait ${waitTime}s`;
    ErrorHandler.handleValidationError(
      'Registration rate limit exceeded',
      null,
      `Too many registration attempts. Please wait ${waitTime} seconds before trying again.`
    );
    setButtonLoading(registerBtn, false);
    return;
  }

  // ✅ Validação de username
  const usernameValidation = Validation.username.validate(username);
  if (!usernameValidation.valid) {
    errorEl.textContent = usernameValidation.error!;
    ErrorHandler.handleValidationError('Invalid username', { username }, usernameValidation.error!);
    setButtonLoading(registerBtn, false);
    return;
  }

  // ✅ Validação de email
  if (!Validation.email.isValid(email)) {
    errorEl.textContent = 'Invalid email format';
    ErrorHandler.handleValidationError('Invalid email format', { email }, 'Please enter a valid email address.');
    setButtonLoading(registerBtn, false);
    return;
  }

  if (CAPTCHA_REQUIRED && !captchaToken) {
    errorEl.textContent = 'Complete the captcha before signing up.';
    ErrorHandler.handleValidationError('Captcha required', null, 'Please complete the captcha to continue.');
    setButtonLoading(registerBtn, false);
    return;
  }
  
  if (password !== confirm) {
    errorEl.textContent = 'The passwords dont match.';
    ErrorHandler.handleValidationError('Password mismatch', null, 'Passwords do not match. Please try again.');
    setButtonLoading(registerBtn, false);
    return;
  }
  
  // ✅ Validação de força de senha
  const passwordStrength = Validation.password.checkStrength(password);
  if (passwordStrength.score < 2) { // Pelo menos "Fair"
    const feedback = passwordStrength.feedback.join('. ');
    errorEl.textContent = `Weak password: ${feedback}`;
    ErrorHandler.handleValidationError(
      'Password too weak',
      { score: passwordStrength.score, label: passwordStrength.label },
      `Password is too weak (${passwordStrength.label}). ${feedback}`
    );
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
      ErrorHandler.handleAuthError(
        'Registration failed',
        { error: authError.message, email, username },
        authError.message || 'Unable to create account.'
      );
      setButtonLoading(registerBtn, false);
      return;
    }
    
    if (!authData.user) {
      errorEl.textContent = 'Error creating account';
      ErrorHandler.handleAuthError(
        'Registration failed - no user returned',
        { email, username },
        'Unable to create account. Please try again.'
      );
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
      errorEl.textContent = 'Error creating profile: ' + dbError.message;
      ErrorHandler.handleDatabaseError(
        'Failed to create player profile',
        { error: dbError.message, userId: authData.user.id }
      );
      showAlert('error', 'Profile Error! ❌', 'Account created but profile setup failed. Please contact support.');
      setButtonLoading(registerBtn, false);
      return;
    }

    // Sync display_name to Supabase Auth (non-blocking)
    try {
      await supabase.auth.admin.updateUserById(authData.user.id, {
        user_metadata: {
          display_name: username
        }
      });
    } catch (authSyncErr) {
      console.warn('Failed to sync display_name during registration:', (authSyncErr as any)?.message || authSyncErr);
      // Non-blocking: continue even if sync fails
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
      ErrorHandler.handleError('Failed to save terms acceptance', {
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.WARNING,
        details: termsError,
        showToUser: false
      });
    }

    if (referralCode) {
      storePendingReferral(referralCode, authData.user.id);
      if (authData.session?.access_token) {
        await attemptReferralLink(referralCode, authData.user.id, authData.session.access_token);
      }
    }
    
    // ✅ Sucesso - resetar rate limit
    Validation.rateLimit.reset('register');
    
    errorEl.className = 'auth-success';
    errorEl.textContent = '✅ Registration complete! Check your email to activate your account.';
    
    // 🔥 Alert grande e visível sobre email
    showAlert('success', '🎉 Account Created Successfully!', 
      `A confirmation email has been sent to ${email}. \n\nPlease check your email (including spam folder) and click the confirmation link to activate your account. You must verify your email before you can log in.`,
      { duration: 0 } as any
    );
    
    usernameEl.value = '';
    emailEl.value = '';
    passwordEl.value = '';
    confirmEl.value = '';
    if (referralEl) referralEl.value = '';
    resetCaptcha('register');
    setButtonLoading(registerBtn, false);
    
  } catch (err) {
    ErrorHandler.handleError('Unexpected error in registration', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      userMessage: 'Something went wrong. Please try again later.',
      showToUser: true
    });
    errorEl.textContent = 'Unexpected error while creating account.';
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
  if ((window as any).cleanupChat) {
    (window as any).cleanupChat();
  }

  if ((window as any).cleanupFriends) {
    (window as any).cleanupFriends();
  }
  
  // 🛡️ Limpar token CSRF do servidor e localstorage
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await clearCsrfTokenOnServer(session.user.id, session.access_token);
    }
  } catch (err) {
    ErrorHandler.handleError('Failed to clear CSRF token on logout', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
    // Não bloqueia o logout se falhar
  }
  
  // ✅ Limpar variáveis globais ANTES de fazer signOut
  clearActiveUser();

  // Zera sem exibir popups
  (window as any).__suppressCurrencyPopups = true;
  try {
    if ((window as any).playerMoney) (window as any).playerMoney.value = 0;
    if ((window as any).playerDiamonds) (window as any).playerDiamonds.value = 0;
  } finally {
    (window as any).__suppressCurrencyPopups = false;
  }

  if ((window as any).invalidateAdminRoleCache) {
    (window as any).invalidateAdminRoleCache();
  }
  
  // Limpar localStorage
  localStorage.removeItem('appState');
  
  // Limpar Redux store (auth já foi limpo pelo clearActiveUser)
  store.dispatch(dataActions.clearAllData());
  
  // ✅ Fazer signOut por último
  try {
    await supabase.auth.signOut();
  } catch (err) {
    ErrorHandler.handleError('Error signing out', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      userMessage: '⚠️ Logout failed. Please try again.',
      showToUser: true
    });
  }
  
  // Redirecionar para tela de auth com URL
  window.history.pushState({}, '', '/auth');
  
  if (window.goTo) {
    window.goTo('auth-screen');
  }
  
  // Verificar rota após logout
  if (window.checkRouteAuth) {
    setTimeout(() => (window as any).checkRouteAuth?.(), 100);
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
  // 🔥 State Manager - Sincronização central
  setActiveUser(user as any, { persist: false });
  
  try {
    await syncPendingReferral(user);
  } catch (err) {
    console.warn('Pending referral sync failed', (err as any)?.message || err);
  }
  
  const { data, error } = await supabase
    .from('player_stats')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  if (error || !data) {
    ErrorHandler.handleDatabaseError('Failed to load user data', { error, userId: user.id });
    return;
  }
  
  // 🔥 Usar State Manager para sincronizar tudo automaticamente
  try {
    stateManager.setUser({
      id: user.id,
      email: user.email || '',
      username: data.username,
      level: data.level,
      xp: data.xp
    });
    
    stateManager.setMoney(data.money || 0);
    stateManager.setDiamonds(data.diamonds || 0);
    
    // Cache local para rotas evitarem refetch de passes
    window.cachedUnlockedPasses = Array.isArray(data.unlocked_passes)
      ? data.unlocked_passes
      : [];
    window.cachedCaseDiscountLevel = Math.max(0, Number(data.case_discount_level) || 0);
  } catch (err) {
    ErrorHandler.handleError('Failed to sync user state', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
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
    setTimeout(() => (window as any).checkRouteAuth?.(), 100);
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
      (headerAvatar as any).src = data.avatar_url + '?t=' + cacheBust;
    } else {
      const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`;
      (headerAvatar as any).src = avatarUrl;
    }
  }
  if (menuAvatar) {
    if (data.avatar_url) {
      (menuAvatar as any).src = data.avatar_url + '?t=' + cacheBust;
    } else {
      const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`;
      (menuAvatar as any).src = avatarUrl;
    }
  }

  // ⚡ Operações secundárias em paralelo (não bloqueia UI)
  // Separar operações síncronas das assíncronas para melhor performance
  if (loadSavedColors) loadSavedColors();
  if (applyTranslations) applyTranslations();
  
  // Apenas operações assíncronas realmente independentes em Promise.all
  Promise.all([
    checkAndShowAdminButton ? checkAndShowAdminButton() : Promise.resolve(),
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.access_token) {
        await fetchCsrfToken(user.id, sessionData.session.access_token);
      }
    })()
  ]).catch(err => {
    ErrorHandler.handleError('Error loading secondary data', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
  });
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

  // 🛡️ Cleanup global em beforeunload para evitar memory leaks
  window.addEventListener('beforeunload', () => {
    if (authStateSubscription) {
      try {
        authStateSubscription.unsubscribe();
      } catch {
        // ignore
      }
      authStateSubscription = null;
    }
  }, { once: true });

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') {
      // Reusar token se válido; caso ausente/expirado, busca novo
      ensureCsrfForSession(session);
      return;
    }

    // Em refresh com sessão persistida, Supabase dispara INITIAL_SESSION
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
      // Garante CSRF após auto-login/refresh
      ensureCsrfForSession(session);
      loadUserDataCallback(session.user);
      return;
    }

    if (event === 'SIGNED_OUT') {
      // ✅ LIMPAR CHAT PRIMEIRO
      if ((window as any).cleanupChat) {
        (window as any).cleanupChat();
      }

      // ✅ FECHAR E RESETAR PAINEL DO CHAT
      const chatPanel = document.getElementById('chat-panel');
      const chatBtn = document.getElementById('chat-toggle-icon');
      
      if (chatPanel) {
        chatPanel.classList.remove('active');
      }
      
      if (chatBtn) {
        chatBtn.classList.remove('active');
        if (typeof (window as any).setChatToggleIcon === 'function') {
          (window as any).setChatToggleIcon({ count: '0', icon: 'messages-square', showCount: true });
        } else {
          chatBtn.innerHTML = '<span class="header-icon" data-lucide="messages-square"></span><span class="chat-online-count" id="chat-online-count">0</span>';
          if (typeof (window as any).refreshLucideIcons === 'function') {
            (window as any).refreshLucideIcons();
          }
        }
      }

      // Limpar variáveis
      clearActiveUser();
      (window as any).__suppressCurrencyPopups = true;
      try {
        if ((window as any).playerMoney) (window as any).playerMoney.value = 0;
        if ((window as any).playerDiamonds) (window as any).playerDiamonds.value = 0;
      } finally {
        (window as any).__suppressCurrencyPopups = false;
      }
      if ((window as any).invalidateAdminRoleCache) (window as any).invalidateAdminRoleCache();
      
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
        setTimeout(() => (window as any).checkRouteAuth?.(), 100);
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
      ErrorHandler.handleError('Failed to setup 2FA', {
        category: ErrorCategory.AUTH,
        severity: ErrorSeverity.ERROR,
        details: { status: response.status },
        userMessage: 'Could not generate 2FA secret',
        showToUser: true
      });
      return null;
    }

    const data = await response.json();
    if (data.success && data.secret && data.qrCode) {
      return { secret: data.secret, qrCode: data.qrCode };
    }

    return null;
  } catch (error) {
    ErrorHandler.handleError('Error requesting 2FA setup', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: error,
      userMessage: 'Failed to setup 2FA',
      showToUser: true
    });
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
    // Sanitizar e validar o código (remover espaços)
    code = (code || '').replace(/\s+/g, '');
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
      const errorData = await response.json();
      ErrorHandler.handleError('Failed to verify 2FA', {
        category: ErrorCategory.AUTH,
        severity: ErrorSeverity.ERROR,
        details: { status: response.status, error: errorData },
        userMessage: errorData.error || 'Invalid code',
        showToUser: true
      });
      return false;
    }

    const data = await response.json();
    if (data.success) {
      showToast('success', '✅ 2FA Enabled', '2FA has been enabled on your account');
      return true;
    }

    return false;
  } catch (error) {
    ErrorHandler.handleError('Error verifying 2FA', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: error,
      userMessage: 'Failed to verify 2FA code',
      showToUser: true
    });
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
      const errorData = await response.json();
      ErrorHandler.handleError('Failed to disable 2FA', {
        category: ErrorCategory.AUTH,
        severity: ErrorSeverity.ERROR,
        details: { status: response.status, error: errorData },
        userMessage: errorData.error || 'Invalid code',
        showToUser: true
      });
      return false;
    }

    const data = await response.json();
    if (data.success) {
      showToast('success', '✅ 2FA Disabled', '2FA has been removed from your account');
      return true;
    }

    return false;
  } catch (error) {
    ErrorHandler.handleError('Error disabling 2FA', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: error,
      userMessage: 'Failed to disable 2FA',
      showToUser: true
    });
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

/**
 * ============================================================
 * MAGIC LINKS (PASSWORDLESS LOGIN) - OTP via Supabase
 * ============================================================
 */

let otpSendCaptchaToken: string | null = null;

/**
 * Envia um link de login mágico (OTP) para o email do usuário
 */
export async function handleSendMagicLink(): Promise<void> {
  const emailEl = document.getElementById('login-email') as HTMLInputElement | null;
  const errorEl = document.getElementById('login-error');
  const magicLinkBtn = document.getElementById('send-magic-link-btn') as HTMLButtonElement | null;
  
  if (!emailEl || !errorEl) return;
  
  const email = emailEl.value.trim();
  errorEl.textContent = '';
  
  // ✅ Validação de email
  if (!email) {
    errorEl.textContent = 'Please enter your email address';
    return;
  }
  
  if (!Validation.email.isValid(email)) {
    errorEl.textContent = 'Invalid email format';
    return;
  }
  
  setButtonLoading(magicLinkBtn, true);
  
  try {
    const captchaToken = CAPTCHA_REQUIRED ? otpSendCaptchaToken : null;
    
    if (CAPTCHA_REQUIRED && !captchaToken) {
      errorEl.textContent = 'Complete the captcha first';
      setButtonLoading(magicLinkBtn, false);
      return;
    }
    
    const allowedRedirectDomains = [
      'https://lootskirmish.vercel.app',
      'https://www.lootskirmish.com',
      'http://localhost:5173'
    ];
    const currentOrigin = window.location.origin;
    
    if (!allowedRedirectDomains.includes(currentOrigin)) {
      ErrorHandler.handleError('Potential phishing attack detected', {
        category: ErrorCategory.PERMISSION,
        severity: ErrorSeverity.CRITICAL,
        details: { currentOrigin },
        userMessage: 'Invalid redirect domain.',
        showToUser: true
      });
      setButtonLoading(magicLinkBtn, false);
      return;
    }
    
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${currentOrigin}/auth?otp=true`,
        captchaToken: captchaToken || undefined
      }
    });
    
    if (error) {
      errorEl.textContent = error.message || 'Failed to send magic link';
      ErrorHandler.handleAuthError(
        'Magic link send failed',
        { error: error.message, email },
        error.message || 'Unable to send magic link'
      );
      setButtonLoading(magicLinkBtn, false);
      return;
    }
    
    showAlert('success', '✨ Magic Link Sent!', `Check your email at ${email} for the login link. It will expire in 24 hours.`);
    errorEl.textContent = 'Magic link sent! Check your email.';
    errorEl.className = 'auth-success';
    setButtonLoading(magicLinkBtn, false);
    
  } catch (err) {
    ErrorHandler.handleError('Magic link unexpected error', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      userMessage: 'Something went wrong. Please try again.',
      showToUser: true
    });
    setButtonLoading(magicLinkBtn, false);
  }
}

/**
 * Detecta se há OTP na URL e tenta autenticar automaticamente
 */
function detectOTPLogin(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const isOTPLogin = urlParams.get('otp') === 'true';
  const hasError = urlParams.get('error');
  const errorCode = urlParams.get('error_code');
  
  if (!isOTPLogin) return;
  
  if (hasError) {
    if (errorCode === 'otp_expired') {
      showAlert('error', '⏱️ Link Expired', 'This OTP link has expired. Please request a new one.');
    } else {
      showAlert('error', '❌ Authentication Failed', hasError || 'Invalid OTP link');
    }
    window.history.replaceState({}, '', '/auth');
    return;
  }
  
  // O Supabase já processou o OTP na URL e atualizou a sessão
  // Aguardar um pouco para que o estado de autenticação seja processado
  setTimeout(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        showToast('success', 'Welcome! 🎉', 'Logged in with Magic Link');
        // O onAuthStateChange irá redirecionar automaticamente
      } else {
        showAlert('error', '❌ Authentication Failed', 'Could not authenticate with this link');
        window.history.replaceState({}, '', '/auth');
      }
    });
  }, 500);
}

/**
 * Limpa dados antigos do localStorage que não são mais usados
 * (Remember me e CSRF token antigos)
 */
function cleanupOldLocalStorageData(): void {
  try {
    // Remover remember me antigo (inseguro)
    localStorage.removeItem('ls-remembered-auth');
    // Remover CSRF token antigo do localStorage (agora usa memória)
    localStorage.removeItem('ls-csrf-token');
  } catch (err) {
    console.warn('Could not cleanup old localStorage data:', err);
  }
}

function initializeAuthUI(): void {
  cleanupOldLocalStorageData();
  prefillReferralFromUrl();
  detectPasswordReset();
  detectOTPLogin();
  renderHCaptcha();
  
  // 🔐 Inicializar indicadores de força de senha
  initPasswordStrengthIndicators();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAuthUI, { once: true });
} else {
  initializeAuthUI();
}

// 🌍 Expor funções para o escopo global (HTML onclick)
(window as any).handleLogin = handleLogin;
(window as any).handleRegister = handleRegister;
(window as any).handlePasswordReset = handlePasswordReset;
(window as any).handleUpdatePassword = handleUpdatePassword;
(window as any).updatePasswordAfterReset = updatePasswordAfterReset;
(window as any).handleSendMagicLink = handleSendMagicLink;
(window as any).requestSetup2FA = requestSetup2FA;
(window as any).verifyAndEnable2FA = verifyAndEnable2FA;
(window as any).disable2FA = disable2FA;
(window as any).prompt2FACode = prompt2FACode;
