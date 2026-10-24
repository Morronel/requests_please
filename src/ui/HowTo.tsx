import { DIFFICULTIES } from '../game/difficulty';

const SHIFT_MINUTES = DIFFICULTIES.easy.shiftSeconds / 60;

export function HowTo({ onDone, cta }: { onDone(): void; cta: string }) {
  return (
    <main class="screen howto">
      <h1>Onboarding.md</h1>
      <ol class="steps">
        <li>
          <b>Read the request.</b> Every HTTP request lands on your desk as a card.
        </li>
        <li>
          <b>Tap anything.</b> Tap a value to decode it (URL, Base64, HTML, hex), tap the IP to look it up, tap the path for the endpoint's notes. Tools
          cost a second off the shift clock.
        </li>
        <li>
          <b>Judge.</b> <span class="ok">ALLOW</span> or <span class="bad">BLOCK</span>, with the big buttons or by swiping the card. A block asks what
          attack it was.
        </li>
        <li>
          <b>Follow the directives.</b> Each shift the CISO adds a rule ("API v1 is dead"). Breaking one is a <i>policy</i> block.
        </li>
        <li>
          <b>Watch two meters.</b> <b>Integrity</b> drops when an attack gets through. <b>Uptime</b> drops when you block real customers. Either at zero
          ends the run.
        </li>
        <li>
          <b>Write rules, ship patches.</b> Waves of attacks let you deploy a WAF rule. Devs sometimes need you to pick the right code fix.
        </li>
        <li>
          <b>Beat the clock.</b> A shift is a fixed {SHIFT_MINUTES} minutes. Nothing fails if you're slow, but every correct call scores and fast
          ones earn a speed bonus, so the better you get, the higher you score.
        </li>
      </ol>
      <p class="muted">Not everything scary is an attack. Mr. O'Brien would like to sign up.</p>
      <button class="btn big primary" onClick={onDone}>
        {cta}
      </button>
    </main>
  );
}
