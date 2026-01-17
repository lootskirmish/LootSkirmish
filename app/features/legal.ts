// ============================================================
// LEGAL.JS - Sistema de Termos e Políticas
// ============================================================

import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../shared/error-handler';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface Subsection {
  subheading: string;
  content: string;
}

interface Section {
  heading: string;
  content?: string;
  subsections?: Subsection[];
}

interface LegalDocument {
  title: string;
  lastUpdated: string;
  sections: Section[];
}

interface LegalContent {
  terms: LegalDocument;
  privacy: LegalDocument;
}

declare global {
  interface Window {
    openSupport?: () => void;
    goTo?: (screen: string) => void;
    goToLegal: (tab?: string) => void;
  }
}

/**
 * Carrega o conteúdo legal do JSON
 */
async function loadLegalContent(): Promise<void> {
  try {
    const response = await fetch('/legal-content.json');
    if (!response.ok) throw new Error('Failed to load legal content');
    
    const data = await response.json();
    
    // Renderizar Terms
    const termsContent = document.getElementById('terms-content-text');
    if (termsContent && data.terms) {
      termsContent.innerHTML = renderSections(data.terms.sections);
    }
    
    // Renderizar Privacy
    const privacyContent = document.getElementById('privacy-content-text');
    if (privacyContent && data.privacy) {
      privacyContent.innerHTML = renderSections(data.privacy.sections);
    }
  } catch (error) {
    ErrorHandler.handleError('Error loading legal content', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: error,
      showToUser: false
    });
  }
}

/**
 * Renderiza as seções de conteúdo legal
 */
function renderSections(sections: Section[]): string {
  return sections.map(section => {
    let html = `<h4>${section.heading}</h4>`;
    
    if (section.content) {
      html += `<p>${section.content}</p>`;
    }
    
    if (section.subsections && Array.isArray(section.subsections)) {
      html += section.subsections.map(subsection => `
        <h5>${subsection.subheading}</h5>
        <p>${subsection.content}</p>
      `).join('');
    }
    
    return html;
  }).join('');
}

/**
 * Inicializa o sistema de páginas legais
 */
export function initLegal(): void {
  const tabs = document.querySelectorAll('.legal-tab');
  const contents = document.querySelectorAll('.legal-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = (tab as HTMLElement).dataset.legalTab;
      
      // Se for Support, abrir o modal ao invés de trocar aba
      if (targetTab === 'support') {
        if (window.openSupport) {
          window.openSupport();
        }
        return;
      }
      
      // Remove active de todas as tabs e contents
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      // Ativa a tab clicada
      tab.classList.add('active');
      const targetContent = document.querySelector(`[data-legal-content="${targetTab}"]`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });
  
  // Carregar conteúdo do JSON
  loadLegalContent();
}

/**
 * Função global para navegar até a página legal
 */
window.goToLegal = function(tab = 'terms') {
  // Se for support, abrir modal diretamente
  if (tab === 'support') {
    if (window.openSupport) {
      window.openSupport();
    }
    return;
  }
  
  if (window.goTo) {
    window.goTo('legal');
  }
  
  // Ativar a tab específica
  setTimeout(() => {
    const targetTab = document.querySelector(`[data-legal-tab="${tab}"]`);
    if (targetTab) {
      (targetTab as HTMLElement).click();
    }
  }, 100);
};
