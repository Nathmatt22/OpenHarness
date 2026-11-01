/**
 * Preload of the virtual-machine desktop window. It exposes nothing: the page
 * is plain HTML; the bridge only keeps the window closed to Node access.
 */
import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('openharnessDesktop', { isolated: true });
