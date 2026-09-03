/**
 * The map canvas announces its first painted pin frame on this window event.
 *
 * A leaf module on purpose: the shell that hosts the map and the browser suite
 * both need the name, and neither may pull the MapLibre canvas graph in to get
 * it. `detail` carries the reveal reason and generation from the pin-reveal
 * coordinator; listeners that only need "the map has painted" ignore it.
 */
export const MAP_PIN_REVEAL_EVENT = "pubmax:pin-reveal";
