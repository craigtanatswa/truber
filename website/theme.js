(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var STORAGE_KEY = "truber-theme";
  var root = document.documentElement;
  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  var buttons = [];
  var stored = null;

  function readStored() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function effectiveTheme() {
    return stored || (darkQuery.matches ? "dark" : "light");
  }

  function createSvg(className, shapes) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    shapes.forEach(function (shape) {
      svg.appendChild(shape);
    });
    return svg;
  }

  function createPath(d) {
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    return path;
  }

  function createCircle(cx, cy, r) {
    var circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(r));
    return circle;
  }

  function createButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.appendChild(createSvg("theme-icon theme-icon--moon", [
      createPath("M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z")
    ]));
    button.appendChild(createSvg("theme-icon theme-icon--sun", [
      createCircle(12, 12, 4),
      createPath("M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M4.93 19.07l1.41-1.41 M17.66 6.34l1.41-1.41")
    ]));
    button.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      stored = next;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (error) {}
      root.setAttribute("data-theme", next);
      updateButtons();
    });
    return button;
  }

  function updateButtons() {
    var theme = effectiveTheme();
    var label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
    buttons.forEach(function (button) {
      button.setAttribute("data-theme-state", theme);
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    stored = readStored();
    if (stored) {
      root.setAttribute("data-theme", stored);
    }
    document.querySelectorAll("#theme-toggle-slot").forEach(function (slot) {
      if (!slot.querySelector(".theme-toggle")) {
        var button = createButton();
        slot.appendChild(button);
        buttons.push(button);
      }
    });
    updateButtons();
    if (!stored) {
      var onSystemChange = function () {
        if (!stored) {
          updateButtons();
        }
      };
      if (darkQuery.addEventListener) {
        darkQuery.addEventListener("change", onSystemChange);
      } else {
        darkQuery.addListener(onSystemChange);
      }
    }
  });

})();
