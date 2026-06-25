// entry point: register modules and boot the generic loader. names a concept only
// in the registration list; all rendering logic lives in the loader.
import './styles.css';
import { createLoader } from './lib/loader.js';
import { occupancy } from './modules/occupancy.js';
import { stencil } from './modules/stencil.js';

createLoader({
  modules: [occupancy, stencil],
  mount: document.querySelector('#app'),
});
