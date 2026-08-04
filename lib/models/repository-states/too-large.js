/** @babel */
import State from "./state";

/**
 * The repository is too large for the editor to handle
 */
export default class TooLarge extends State {
  isTooLarge() {
    return true;
  }
}

State.register(TooLarge);
