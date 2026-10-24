import { t } from '../i18n';
import logo from '../assets/binary-xor.webp';

export const CHANNEL = 'https://t.me/binary_xor';
export const FRIENDS = 'https://t.me/DC8044_Info';

/** Small Telegram plug shown under the game-over stats. */
export function ChannelPlug() {
  return (
    <a class="plug" href={CHANNEL} target="_blank" rel="noopener noreferrer">
      <img class="plug-logo" src={logo} alt="" width={64} height={64} loading="lazy" />
      <span class="plug-text">
        <b>{t('Off shift? Join /binary_xor')}</b>
        <span>{t('Free learning materials now and then, plus a friendly Ukrainian-speaking crew. Most of us speak English too.')}</span>
        <span class="plug-cta">{t('Subscribe on Telegram')} →</span>
      </span>
    </a>
  );
}

/** Credits screen from the menu. */
export function Credits({ onBack }: { onBack(): void }) {
  return (
    <main class="screen credits">
      <header class="bar">
        <button class="btn small" onClick={onBack}>
          ← {t('Back')}
        </button>
        <h1>{t('Credits')}</h1>
        <span />
      </header>
      <h2 class="label">{t('Made by')}</h2>
      <a class="plug" href={CHANNEL} target="_blank" rel="noopener noreferrer">
        <img class="plug-logo" src={logo} alt="" width={64} height={64} />
        <span class="plug-text">
          <b>/binary_xor</b>
          <span>{t('Security, free learning materials and a Ukrainian-speaking community.')}</span>
          <span class="plug-cta">t.me/binary_xor →</span>
        </span>
      </a>
      <h2 class="label">{t('Friends')}</h2>
      <a class="plug" href={FRIENDS} target="_blank" rel="noopener noreferrer">
        <span class="plug-text">
          <b>DC8044</b>
          <span>{t('Our friends from the DC8044 community.')}</span>
          <span class="plug-cta">t.me/DC8044_Info →</span>
        </span>
      </a>
    </main>
  );
}
