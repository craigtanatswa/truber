(function () {
  "use strict";

  var STATUS_TEXT = "Demo: not sent. Nothing you entered was sent or stored.";

  function syncMatchField(field) {
    var otherId = field.getAttribute("data-match");
    if (!otherId) {
      return;
    }
    var other = document.getElementById(otherId);
    if (other && other.value !== field.value) {
      field.setCustomValidity("Passwords do not match");
    } else {
      field.setCustomValidity("");
    }
  }

  function syncAllMatches(form) {
    form.querySelectorAll("[data-match]").forEach(syncMatchField);
  }

  function handleForm(form) {
    form.classList.add("was-validated");
    syncAllMatches(form);

    var status = form.querySelector(".form-status");
    var valid = form.reportValidity();

    if (valid) {
      if (status) {
        status.textContent = STATUS_TEXT;
        status.hidden = false;
      }
      return;
    }

    if (status) {
      status.hidden = true;
      status.textContent = "";
    }

    var firstInvalid = form.querySelector(":invalid");
    if (firstInvalid) {
      firstInvalid.focus();
    }
  }

  function syncAccountType(form) {
    var line = form.querySelector("[data-account-type-line], .account-type-line");
    if (!line) {
      return;
    }
    var checked = form.querySelector('input[name="account-type"]:checked');
    if (!checked) {
      return;
    }
    var value = (checked.value || "").toLowerCase();
    if (value !== "shipper" && value !== "transporter") {
      return;
    }
    line.textContent = "You’re signing in as a " + value + ".";
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("form.demo-form").forEach(function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        handleForm(form);
      });

      form.addEventListener("invalid", function () {
        form.classList.add("was-validated");
      }, true);

      form.querySelectorAll(".demo-submit").forEach(function (button) {
        button.removeAttribute("disabled");
        button.addEventListener("click", function () {
          form.classList.add("was-validated");
          syncAllMatches(form);
        });
      });

      form.querySelectorAll('input[name="account-type"]').forEach(function (radio) {
        radio.addEventListener("change", function () {
          syncAccountType(form);
        });
      });

      form.querySelectorAll("[data-match]").forEach(function (field) {
        field.addEventListener("input", function () {
          syncMatchField(field);
        });
      });

      syncAccountType(form);
    });
  });
})();
