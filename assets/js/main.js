/* BNEF Summit London — site foundation behaviour
   Mobile nav toggle, agenda day tabs, agenda track filters,
   day-pill selection in the form, and a stub form submit handler.
   No build step required — vanilla JS, no dependencies. */

document.addEventListener('DOMContentLoaded', function () {

  /* ---------- mobile nav ---------- */
  var navToggle = document.querySelector('.site-nav__toggle');
  var navLinks = document.querySelector('.site-nav__links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('is-open');
      });
    });
  }

  /* ---------- agenda: day tabs + track filters ----------
     Handled by assets/js/agenda.js, which builds the day-toggle and
     track-filters controls at render time (once live data has loaded)
     and wires their click handlers itself via wireAgendaControls(). */

  /* ---------- registration form: day pills ---------- */
  var dayPills = document.querySelectorAll('[data-day-pill]');
  dayPills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      dayPills.forEach(function (p) { p.classList.remove('is-selected'); });
      pill.classList.add('is-selected');
      var input = document.getElementById('attendance-days');
      if (input) { input.value = pill.getAttribute('data-day-pill'); }
    });
  });

  /* ---------- registration form: stub submit ----------
     No backend is wired up yet. Replace this handler with a real
     submission (fetch to your CRM/marketing-automation endpoint) —
     this just prevents a real page reload and confirms the click. */
  var form = document.getElementById('register-form');
  var status = document.getElementById('register-status');
  if (form && status) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.textContent = 'Thanks — this form isn’t wired up to a backend yet. Connect it to your registration system to go live.';
      status.classList.add('is-visible');
    });
  }

});
