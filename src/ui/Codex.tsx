import { useState } from 'preact/hooks';
import { CLASSES } from '../game/codex';
import { t } from '../i18n';
import type { AttackClass } from '../game/types';
import { store } from '../storage';

export function Codex({ onBack }: { onBack(): void }) {
  const [open, setOpen] = useState<AttackClass | null>(null);
  const unlocked = new Set(store.codex);
  return (
    <main class="screen codex">
      <header class="bar">
        <button class="btn small" onClick={onBack}>
          ← {t('Back')}
        </button>
        <h1>{t('Codex')}</h1>
        <span class="muted">
          {unlocked.size}/{Object.keys(CLASSES).length}
        </span>
      </header>
      <p class="muted">{t('Meet an attack in a run to unlock its entry.')}</p>
      <ul class="codex-list">
        {Object.values(CLASSES).map((c) => {
          const known = unlocked.has(c.id);
          const isOpen = open === c.id && known;
          return (
            <li class={`codex-item ${known ? '' : 'locked'}`}>
              <button class="codex-head" disabled={!known} onClick={() => setOpen(isOpen ? null : c.id)}>
                <span class="icon">{known ? c.icon : '??'}</span>
                <span>{known ? t(c.name) : t('Unknown attack')}</span>
                <span class="muted">{known ? (isOpen ? '−' : '+') : t('locked')}</span>
              </button>
              {isOpen && (
                <div class="codex-body">
                  <p>
                    <b>{t('Tell:')}</b> {t(c.tell)}
                  </p>
                  <pre class="code">{c.payload}</pre>
                  <p>
                    <b>{t('Why it works:')}</b> {t(c.why)}
                  </p>
                  <p>
                    <b>{t('Real fix:')}</b> {t(c.fix)}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
