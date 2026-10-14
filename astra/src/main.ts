import { Simulation } from "./core/Simulation";
import "./style.css";
import "./ui/refinements.css";
declare global {
  interface Window {
    __sim: Simulation;
  }
}
let sim = new Simulation(document.querySelector("#app")!);
window.__sim = sim;
window.addEventListener("pagehide", () => sim.dispose());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    sim = new Simulation(document.querySelector("#app")!);
    window.__sim = sim;
  }
});
