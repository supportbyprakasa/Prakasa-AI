import { createFormRegistry } from './aiFormModel.js';

// The forms registered on the page right now (usePrakasaAIForm). One registry
// for the tab: forms live in routes, dialogs and the top bar alike.
const aiFormRegistry = createFormRegistry();
export default aiFormRegistry;
