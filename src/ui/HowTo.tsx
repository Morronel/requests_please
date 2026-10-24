import { t } from '../i18n';

export function HowTo({ onDone, cta }: { onDone(): void; cta: string }) {
  return (
    <main class="screen howto">
      <h1>Onboarding.md</h1>
      <ol class="steps">
        <li>
          <b>{t('Read the request.')}</b> {t('Every HTTP request lands on your desk as a card.')}
        </li>
        <li>
          <b>{t('Tap anything.')}</b> {t("Tap a value to decode it (URL, Base64, HTML, hex), tap the IP to look it up, tap the path for the endpoint's notes. Tools cost a second.")}
        </li>
        <li>
          <b>{t('Judge.')}</b> <span class="ok">{t('ALLOW')}</span> {t('or')} <span class="bad">{t('BLOCK')}</span>
          {t(', with the big buttons or by swiping the card. A block asks what attack it was.')}
        </li>
        <li>
          <b>{t('Follow the directives.')}</b> {t('Each shift the CISO adds a rule ("API v1 is dead"). Breaking one is a policy block.')}
        </li>
        <li>
          <b>{t('Watch two meters.')}</b> {t('Integrity drops when an attack gets through. Uptime drops when you block real customers. Either at zero ends the run.')}
        </li>
        <li>
          <b>{t('Write rules, ship patches.')}</b> {t('Waves of attacks let you deploy a WAF rule. Devs sometimes need you to pick the right code fix.')}
        </li>
        <li>
          <b>{t('Too slow?')}</b> {t('The WAF fails open. That means the request is allowed.')}
        </li>
      </ol>
      <p class="muted">{t("Not everything scary is an attack. Mr. O'Brien would like to sign up.")}</p>
      <button class="btn big primary" onClick={onDone}>
        {cta}
      </button>
    </main>
  );
}
