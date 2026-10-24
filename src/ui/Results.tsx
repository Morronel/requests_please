import { useState } from 'preact/hooks';
import { DIFFICULTIES } from '../game/difficulty';
import { getLang, t } from '../i18n';
import type { Difficulty } from '../game/types';
import { store, type BoardEntry } from '../storage';

function when(at: number): string {
  if (!at) return '–';
  return new Date(at).toLocaleDateString(getLang() === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short' });
}

/** The top runs for one difficulty, with `highlight` marking the run that just ended. */
export function BoardTable({ rows, highlight = -1 }: { rows: BoardEntry[]; highlight?: number }) {
  if (!rows.length) return <p class="muted board-empty">{t('No runs yet. Clock in and set the bar.')}</p>;
  return (
    <ol class="board">
      {rows.map((r, i) => (
        <li class={i === highlight ? 'board-row you' : 'board-row'}>
          <span class="board-pos">{i + 1}</span>
          <span class="board-main">
            <b>{r.score}</b> <span class="muted">{t(r.rank)}</span>
            <span class="board-meta">
              {t('shift {shift} · {acc}% · {date}', { shift: r.shift, acc: Math.round(r.accuracy * 100), date: when(r.at) })}
            </span>
          </span>
          <span class={r.ended === 'out' ? 'board-end ok' : 'board-end bad'}>{r.ended === 'out' ? t('clocked out') : t('fired')}</span>
        </li>
      ))}
    </ol>
  );
}

/** Results screen from the menu: one board per endless difficulty. */
export function Results({ onBack, initial = 'easy' }: { onBack(): void; initial?: Difficulty }) {
  const [diff, setDiff] = useState<Difficulty>(initial);
  return (
    <main class="screen results">
      <header class="bar">
        <button class="btn small" onClick={onBack}>
          ← {t('Back')}
        </button>
        <h1>{t('Results')}</h1>
        <span />
      </header>
      <div class="settings">
        {(Object.keys(DIFFICULTIES) as Difficulty[]).map((id) => (
          <button class={`chip ${id === diff ? 'on' : ''}`} onClick={() => setDiff(id)}>
            {t(id.toUpperCase())}
          </button>
        ))}
      </div>
      <BoardTable rows={store.board(diff)} />
    </main>
  );
}
