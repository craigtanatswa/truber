(function () {
  "use strict";

  var STORAGE_KEY = "truber-theme";
  var MODES = ["system", "light", "dark"];
  var LABELS = { system: "System", light: "Light", dark: "Dark" };
  var mode = "system";
  var buttons = [];

  function readStoredMode() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") {
        return stored;
      }
    } catch (error) {
      return "system";
    }
    return "system";
  }

  function updateButtons() {
    var label = LABELS[mode];
    var description = "Theme: " + label;
    buttons.forEach(function (button) {
      button.textContent = label;
      button.setAttribute("aria-label", description);
      button.setAttribute("title", description);
    });
  }

  function applyMode(next) {
    mode = next;
    try {
      if (next === "system") {
        document.documentElement.removeAttribute("data-theme");
        localStorage.removeItem(STORAGE_KEY);
      } else {
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch (error) {
      if (next === "system") {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", next);
      }
    }
    updateButtons();
  }

  function nextMode() {
    var index = MODES.indexOf(mode);
    return MODES[(index + 1) % MODES.length];
  }

  document.addEventListener("DOMContentLoaded", function () {
    mode = readStoredMode();

    document.querySelectorAll("#theme-toggle-slot").forEach(function (slot) {
      if (slot.querySelector(".theme-toggle")) {
        return;
      }
      var button = document.createElement("button");
      button.type = "button";
      button.className = "theme-toggle";
      button.addEventListener("click", function () {
        applyMode(nextMode());
      });
      slot.appendChild(button);
      buttons.push(button);
    });

    updateButtons();
  });
})();
