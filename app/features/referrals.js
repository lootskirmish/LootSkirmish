import { supabase } from './auth.js';
import { showAlert, showToast } from '../shared/effects.js';

const TYPE_META = {
  spend_commission: { icon: '🪙', label: 'Commission' },
  win_commission: { icon: '🏆', label: 'Win commission' },
  diamond_bonus: { icon: '💎', label: 'Diamond bonus' },
  withdrawal: { icon: '⬇️', label: 'Withdrawal' },
  commission: { icon: '🪙', label: 'Commission' },
  daily_interest: { icon: '📈', label: 'Daily interest (5%)' }
};

let isLoading = false;
let historyPage = 1;
let historyHasMore = true;
let countdownTimer = null;
let nextWithdrawAtCache = null;

function getEls() {
  return {
    skeleton: document.getElementById('referrals-skeleton'),
    content: document.getElementById('referrals-content'),
    code: document.getElementById('referral-code'),
    link: document.getElementById('referral-link'),
    copyBtn: document.getElementById('referral-copy-btn'),
    badge: document.getElementById('referral-badge'),
    tierChip: document.getElementById('referral-tier-chip'),
    tierLabel: document.getElementById('referral-tier-label'),
    tierPercent: document.getElementById('referral-tier-percent'),
    percent: document.getElementById('referral-percent'),
    count: document.getElementById('referral-count'),
    pending: document.getElementById('referral-pending'),
    totalWithdrawn: document.getElementById('referral-total-withdrawn'),
    totalEarned: document.getElementById('referral-total-earned'),
    withdrawBtn: document.getElementById('referral-withdraw-btn'),
    withdrawNote: document.getElementById('referral-withdraw-note'),
    countdown: document.getElementById('referral-countdown'),
    historyList: document.getElementById('referral-history-list'),
    historyEmpty: document.getElementById('referral-history-empty'),
    historyLoad: document.getElementById('referral-history-load')
  };
}

function formatCoins(amount) {
  const num = Number(amount || 0);
  return `${num.toFixed(2)} 🪙`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

function toggleLoading(show) {
  const { skeleton, content } = getEls();
  if (skeleton) skeleton.style.display = show ? 'grid' : 'none';
  if (content) content.style.display = show ? 'none' : 'block';
}

async function fetchReferralStats() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const response = await fetch('/api/_referrals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'getReferralStats',
      userId: session.user.id,
      authToken: session.access_token
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Failed to load referrals');
  }
  return { data: result, session };
}

function startCountdown(nextWithdrawAt) {
  const { countdown } = getEls();
  clearInterval(countdownTimer);
  if (!countdown) return;

  if (!nextWithdrawAt) {
    countdown.textContent = 'Ready to withdraw';
    return;
  }

  nextWithdrawAtCache = nextWithdrawAt;
  const target = new Date(nextWithdrawAt).getTime();

  const tick = () => {
    const diff = target - Date.now();
    if (diff <= 0) {
      clearInterval(countdownTimer);
      countdown.textContent = 'Ready to withdraw';
      return;
    }
    const hours = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    const secs = Math.floor((diff % 60_000) / 1000);
    countdown.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
}

function renderHistory(items, { reset = false } = {}) {
  const { historyList, historyEmpty } = getEls();
  if (!historyList) return;
  if (reset) historyList.innerHTML = '';

  if (!items || items.length === 0) {
    if (historyEmpty) historyEmpty.style.display = historyList.children.length ? 'none' : 'block';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach(tx => {
    const meta = TYPE_META[tx.type] || { icon: '📝', label: tx.type };
    const row = document.createElement('div');
    row.className = 'referral-history-item';
    row.innerHTML = `
      <div class="referral-history-meta">
        <div><span>${meta.icon}</span> <strong>${meta.label}</strong></div>
        <small>${formatDate(tx.created_at)}</small>
      </div>
      <div class="referral-amount">${formatCoins(tx.amount)}</div>
    `;
    fragment.appendChild(row);
  });

  historyList.appendChild(fragment);
  if (historyEmpty) historyEmpty.style.display = historyList.children.length ? 'none' : 'block';
}

function renderStats(data) {
  const {
    code,
    link,
    badge,
    tierChip,
    tierLabel,
    tierPercent,
    percent,
    count,
    pending,
    totalWithdrawn,
    totalEarned,
    withdrawBtn,
    withdrawNote
  } = getEls();

  if (code) code.textContent = data.code || 'username';
  if (link) link.value = data.shareLink || `${window.location.origin}/auth?ref=${data.code || ''}`;
  const percentFormatted = parseFloat((data.tierPercent || 0).toFixed(1));
  if (badge) badge.textContent = `${data.tierLabel || 'Level'} • ${percentFormatted}%`;
  if (tierLabel) tierLabel.textContent = data.tierLabel || 'Tier';
  if (tierPercent) tierPercent.textContent = `${percentFormatted}%`;
  if (percent) percent.textContent = `${percentFormatted}%`;
  if (count) count.textContent = data.referredCount ?? 0;
  if (pending) pending.textContent = formatCoins(data.pendingBalance || 0);
  if (totalWithdrawn) totalWithdrawn.textContent = formatCoins(data.totalWithdrawn || 0);
  if (totalEarned) totalEarned.textContent = formatCoins(data.totalEarned || 0);

  const canWithdraw = data.canWithdraw !== false && (data.pendingBalance || 0) > 0;
  if (withdrawBtn) {
    withdrawBtn.disabled = !canWithdraw;
  }
  if (withdrawNote) {
    if (data.canWithdraw === false) {
      withdrawNote.textContent = 'Come back tomorrow to withdraw again.';
    } else if ((data.pendingBalance || 0) > 0) {
      withdrawNote.innerHTML = '💡 <strong>Passive income:</strong> Your balance earns 5% interest daily at 00:00 UTC if not withdrawn!';
      withdrawNote.style.color = '#22c55e';
    } else {
      withdrawNote.textContent = 'One withdraw per day (resets at 00:00 UTC).';
      withdrawNote.style.color = '';
    }
  }

  if (tierChip) {
    tierChip.style.borderColor = data.tierPercent ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)';
  }

  startCountdown(data.nextWithdrawAt || null);
}

async function loadReferralPanel() {
  if (isLoading) return;
  isLoading = true;
  toggleLoading(true);
  historyPage = 1;
  historyHasMore = true;

  try {
    const { data } = await fetchReferralStats();
    renderStats(data);
    renderHistory(data.transactions || [], { reset: true });
  } catch (err) {
    console.error('referrals load error', err);
    showAlert('error', 'Referral error', err.message || 'Could not load referrals');
  } finally {
    toggleLoading(false);
    isLoading = false;
  }
}

async function withdrawEarnings() {
  const { withdrawBtn } = getEls();
  if (!withdrawBtn) return;
  withdrawBtn.disabled = true;
  withdrawBtn.classList.add('loading');
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    const response = await fetch('/api/_referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'withdrawEarnings',
        userId: session.user.id,
        authToken: session.access_token
      })
    });

    const result = await response.json();
    if (!response.ok) {
      if (result.nextWithdrawAt) startCountdown(result.nextWithdrawAt);
      throw new Error(result.error || 'Withdraw failed');
    }

    showToast('success', 'Withdraw completed', `You received ${formatCoins(result.withdrawn)}.`);
    if (typeof window.playerMoney === 'object') {
      window.playerMoney.value = result.newWalletBalance ?? window.playerMoney.value;
    }
    await loadReferralPanel();
  } catch (err) {
    console.error('withdraw error', err);
    showAlert('error', 'Withdraw error', err.message || 'Unable to withdraw');
  } finally {
    withdrawBtn.classList.remove('loading');
    withdrawBtn.disabled = false;
  }
}

async function loadMoreHistory() {
  if (!historyHasMore) return;
  const { historyLoad } = getEls();
  if (historyLoad) historyLoad.disabled = true;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;

  const nextPage = historyPage + 1;
  const response = await fetch('/api/_referrals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'getTransactionHistory',
      userId: session.user.id,
      authToken: session.access_token,
      page: nextPage,
      pageSize: 15
    })
  });

  const result = await response.json();
  if (!response.ok) {
    showAlert('error', 'History error', result.error || 'Unable to load history');
    if (historyLoad) historyLoad.disabled = false;
    return;
  }

  const total = Number(result.total || 0);
  const already = nextPage * (result.pageSize || 15);
  historyHasMore = already < total;
  historyPage = nextPage;
  renderHistory(result.transactions || [], { reset: false });
  if (historyLoad) {
    historyLoad.disabled = !historyHasMore;
    historyLoad.textContent = historyHasMore ? 'Load more' : 'All caught up';
  }
}

function copyLink() {
  const { link, copyBtn } = getEls();
  if (!link || !copyBtn) return;
  navigator.clipboard.writeText(link.value).then(() => {
    copyBtn.classList.add('copied');
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.textContent = 'Copy';
    }, 1200);
  }).catch(() => {
    showAlert('error', 'Copy failed', 'Could not copy link');
  });
}

function bindReferralsUI() {
  const { copyBtn, withdrawBtn, historyLoad } = getEls();
  if (copyBtn && !copyBtn.dataset.bound) {
    copyBtn.addEventListener('click', copyLink);
    copyBtn.dataset.bound = '1';
  }
  if (withdrawBtn && !withdrawBtn.dataset.bound) {
    withdrawBtn.addEventListener('click', withdrawEarnings);
    withdrawBtn.dataset.bound = '1';
  }
  if (historyLoad && !historyLoad.dataset.bound) {
    historyLoad.addEventListener('click', () => loadMoreHistory());
    historyLoad.dataset.bound = '1';
  }
}

bindReferralsUI();

if (typeof window !== 'undefined') {
  window.loadReferralsPanel = loadReferralPanel;
}
