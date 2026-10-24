import { render } from 'preact';
import { initAudio } from './audio';
import { App } from './ui/App';
import './styles.css';

initAudio();
render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
