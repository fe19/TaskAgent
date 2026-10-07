import { EventEmitter } from 'node:events';

/** In-process event bus; the web UI relays it over SSE. */
export class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  publish(type, payload) {
    this.emit('event', { type, payload, at: new Date().toISOString() });
  }
}
