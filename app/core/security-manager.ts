// ============================================================
// SECURITY-MANAGER.TS - Advanced Session & Security Management
// ============================================================

import { supabase } from '../features/auth';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../shared/error-handler';
import { showToast, showAlert } from '../shared/effects';

// ============================================================
// TYPES
// ============================================================

export interface ActiveDevice {
  id: string;
  device_name: string;
  device_type: string; // mobile, desktop, tablet
  browser: string;
  ip_address: string;
  user_agent: string;
  last_activity: string;
  is_current: boolean;
  created_at: string;
}

export interface LoginAttempt {
  id: string;
  success: boolean;
  ip_address: string;
  user_agent: string;
  reason?: string;
  created_at: string;
}

// ============================================================
// DEVICE & SESSION MANAGEMENT
// ============================================================

/**
 * Retorna dispositivos ativos associados à conta do usuário
 */
export async function getActiveDevices(): Promise<ActiveDevice[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return [];
    
    const { data, error } = await supabase
      .from('active_devices')
      .select('*')
      .eq('user_id', user.id)
      .order('last_activity', { ascending: false });
    
    if (error) {
      console.error('Error fetching active devices:', error);
      return [];
    }
    
    return data || [];
  } catch (err) {
    ErrorHandler.handleError('Error fetching active devices', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
    return [];
  }
}

/**
 * Registra um novo dispositivo/sessão
 */
export async function registerDevice(deviceInfo: Partial<ActiveDevice>): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return false;
    
    // Gerar hash do dispositivo (browser + user agent)
    const deviceHash = btoa(`${deviceInfo.browser || 'unknown'}:${deviceInfo.user_agent || 'unknown'}`);
    
    const { error } = await supabase.from('active_devices').insert({
      user_id: user.id,
      device_name: deviceInfo.device_name || `Device ${new Date().toLocaleDateString()}`,
      device_type: deviceInfo.device_type || 'desktop',
      browser: deviceInfo.browser || 'unknown',
      ip_address: deviceInfo.ip_address || 'unknown',
      user_agent: deviceInfo.user_agent || 'unknown',
      device_hash: deviceHash,
      is_current: true,
      created_at: new Date().toISOString(),
      last_activity: new Date().toISOString()
    });
    
    if (error) {
      console.error('Error registering device:', error);
      return false;
    }
    
    return true;
  } catch (err) {
    ErrorHandler.handleError('Error registering device', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
    return false;
  }
}

/**
 * Remove/logout de um dispositivo específico
 */
export async function logoutDevice(deviceId: string): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return false;
    
    // Se for o dispositivo atual, fazer logout completo
    const { data: device } = await supabase
      .from('active_devices')
      .select('is_current')
      .eq('id', deviceId)
      .eq('user_id', user.id)
      .single();
    
    if (device?.is_current) {
      // Logout do dispositivo atual
      await supabase.auth.signOut();
      return true;
    } else {
      // Remover dispositivo remoto apenas do banco
      const { error } = await supabase
        .from('active_devices')
        .delete()
        .eq('id', deviceId)
        .eq('user_id', user.id);
      
      if (error) {
        console.error('Error logging out device:', error);
        return false;
      }
      
      showToast('success', '📱 Device Removed', 'Remote device has been logged out');
      return true;
    }
  } catch (err) {
    ErrorHandler.handleError('Error logging out device', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
    return false;
  }
}

/**
 * Logout remoto de todos os outros dispositivos
 */
export async function logoutAllOtherDevices(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return false;
    
    // Obter dispositivos
    const { data: devices } = await supabase
      .from('active_devices')
      .select('id, is_current')
      .eq('user_id', user.id);
    
    if (!devices) return false;
    
    // Remover todos exceto o atual
    for (const device of devices) {
      if (!device.is_current) {
        await supabase
          .from('active_devices')
          .delete()
          .eq('id', device.id);
      }
    }
    
    showToast('success', '🔒 Security Update', 'All other devices have been logged out');
    return true;
  } catch (err) {
    ErrorHandler.handleError('Error logging out all devices', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
    return false;
  }
}

/**
 * Atualiza última atividade de um dispositivo
 */
export async function updateDeviceActivity(deviceId: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    
    await supabase
      .from('active_devices')
      .update({ last_activity: new Date().toISOString() })
      .eq('id', deviceId)
      .eq('user_id', user.id);
  } catch (err) {
    // Falha silenciosa - não afeta a experiência do usuário
  }
}

// ============================================================
// SUSPICIOUS LOGIN DETECTION & ALERTS
// ============================================================

/**
 * Detecta e alerta sobre atividades suspeitas
 */
export async function checkForSuspiciousActivity(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;
    
    // Buscar tentativas de login falhadas recentes
    const { data: failedAttempts } = await supabase
      .from('audit_log')
      .select('*')
      .eq('user_id', user.id)
      .eq('action', 'login_failed')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10);
    
    // Se houver mais de 5 tentativas falhadas em 24h, alertar
    if (failedAttempts && failedAttempts.length > 5) {
      showAlert('warning', '⚠️ Security Alert', 
        `We detected ${failedAttempts.length} failed login attempts in the last 24 hours. If this wasn't you, please change your password immediately.`);
    }
    
    // Buscar logins suspeitos
    const { data: suspiciousLogins } = await supabase
      .from('audit_log')
      .select('*')
      .eq('user_id', user.id)
      .eq('action', 'suspicious_login_detected')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5);
    
    if (suspiciousLogins && suspiciousLogins.length > 0) {
      const details = JSON.parse(suspiciousLogins[0].details || '{}');
      showAlert('warning', '🚨 Suspicious Activity Detected',
        `New login from an unknown location/device. If this wasn't you, change your password and enable 2FA.`);
    }
  } catch (err) {
    ErrorHandler.handleError('Error checking for suspicious activity', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
  }
}

// ============================================================
// LOGIN ATTEMPT MONITORING
// ============================================================

/**
 * Retorna histórico de tentativas de login
 */
export async function getLoginAttempts(daysBack: number = 30): Promise<LoginAttempt[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return [];
    
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .eq('user_id', user.id)
      .in('action', ['login_success', 'login_failed'])
      .gte('created_at', new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });
    
    if (error) return [];
    
    return (data || []).map(entry => ({
      id: entry.id,
      success: entry.action === 'login_success',
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
      reason: entry.details ? JSON.parse(entry.details).reason : undefined,
      created_at: entry.created_at
    }));
  } catch (err) {
    ErrorHandler.handleError('Error fetching login attempts', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
    return [];
  }
}

// ============================================================
// SESSION SECURITY UTILITIES
// ============================================================

/**
 * Detecta o tipo de dispositivo baseado em User Agent
 */
export function detectDeviceType(userAgent: string): string {
  if (/mobile|android|iphone|ipod|windows phone/i.test(userAgent)) return 'mobile';
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  return 'desktop';
}

/**
 * Extrai nome do navegador do User Agent
 */
export function extractBrowserName(userAgent: string): string {
  if (/Chrome/.test(userAgent)) return 'Chrome';
  if (/Safari/.test(userAgent)) return 'Safari';
  if (/Firefox/.test(userAgent)) return 'Firefox';
  if (/Edge|Edg/.test(userAgent)) return 'Edge';
  if (/Opera|OPR/.test(userAgent)) return 'Opera';
  return 'Unknown';
}

/**
 * Verifica se a sessão atual ainda é válida
 */
export async function isSessionValid(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session?.access_token;
  } catch {
    return false;
  }
}
