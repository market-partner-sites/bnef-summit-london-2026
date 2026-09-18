/* BNEF Summit London — agenda + speakers, rendered live from the event APIs.
   No build step, no dependencies — plain fetch() + DOM.

   Data sources:
     Agenda:        GET /api/clients/bnef/events/bnef_summit_london_2026/agendas
     Speakers:       GET /api/clients/bnef/events/bnef_summit_london_2026/registrations?categoryType=Speaker
     Relationships:  GET /api/clients/bnef/events/bnef_summit_london_2026/content-relationships

   The agendas API has no per-session speaker field by itself — the join
   lives in content-relationships: each row links a `left` content item to
   a `right` one. The rows that matter here have left.type === "Session"
   (left.contentId === the session's own `id`, e.g. "Session:abc123...")
   and right.type === "Speaker" (right.contentId === a registration's `id`
   from the speakers API, e.g. "bnef_summit_london_2026-a3d26f..."). Each
   such row's right.categoryId gives the person's role on that session —
   "speaker", "moderator", or "presentations" (this event also has a
   handful of Session -> Entity/"presentations" rows pointing at a Link,
   which is a resource/deck attached to the session, not a person — those
   are ignored below since they don't have a matching speaker record).

   IMPORTANT — CORS: all three endpoints currently only send CORS headers
   that allow bbgevent.app itself to read them. A fetch from any other
   origin (this file opened locally, or the site deployed elsewhere) will
   fail with a generic "Failed to fetch" network error — confirmed by
   testing from a foreign origin.

   To make this work when hosted anywhere other than bbgevent.app (e.g. on
   GitHub Pages), this file tries the live API first, and if that fails —
   which it always will cross-origin today — falls back to a same-origin
   JSON snapshot bundled at data/agenda.json, data/speakers.json and
   data/relationships.json. Those three files are kept fresh by
   .github/workflows/refresh-data.yml, a scheduled GitHub Action that
   fetches the live APIs server-side (no CORS applies there) every ~15
   minutes and commits the results back into the repo. So once this is
   pushed to GitHub with Actions enabled, the site always shows real data
   that's at most ~15 minutes stale, with no proxy or hosting account
   needed. If bbgevent.app's CORS policy is ever opened up for this site's
   origin (or the site ends up hosted on bbgevent.app itself), the live
   fetch above will just start succeeding and the snapshot becomes an
   unused safety net.
   Every render path below fails gracefully either way — a status message
   shows instead of a blank page. */

(function () {

  var AGENDA_API = 'https://bbgevent.app/api/clients/bnef/events/bnef_summit_london_2026/agendas';
  var SPEAKERS_API = 'https://bbgevent.app/api/clients/bnef/events/bnef_summit_london_2026/registrations?categoryType=Speaker';
  var RELATIONSHIPS_API = 'https://bbgevent.app/api/clients/bnef/events/bnef_summit_london_2026/content-relationships';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ROLE_ORDER = ['speaker', 'moderator', 'presentations'];

  /* -------- small helpers -------- */

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function text(tag, className, str) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = str;
    return node;
  }

  // "2026-10-19T17:00:00.000" -> "5:00 PM". Reads the clock time straight
  // out of the string instead of going through Date/timezone conversion,
  // since localStart/localEnd are already the event's own wall-clock time.
  function fmtTime(iso) {
    var m = /T(\d{2}):(\d{2})/.exec(iso);
    if (!m) return '';
    var hour = parseInt(m[1], 10);
    var mins = m[2];
    var ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return hour + ':' + mins + ' ' + ampm;
  }

  // "2026-10-19T..." -> "Oct 19". Manual formatting avoids any local
  // timezone shifting a date-only string by a day.
  function fmtDateLabel(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    var month = MONTHS[parseInt(m[2], 10) - 1];
    var day = parseInt(m[3], 10);
    return month + ' ' + day;
  }

  function dateKey(iso) {
    return (/^\d{4}-\d{2}-\d{2}/.exec(iso) || [''])[0];
  }

  function isBreakLike(session) {
    var tags = session.tags || [];
    return tags.indexOf('label:Networking') !== -1 || tags.indexOf('sessionType:break') !== -1;
  }

  function personFromRegistration(reg) {
    var p = (reg && reg.profile) || {};
    return {
      name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      company: p.company || '',
      jobTitle: p.job_title || '',
      photo: (p.profile_picture && p.profile_picture.absoluteUrl) || '',
      bioHtml: (p.bio && p.bio.html) || ''
    };
  }

  var ROLE_LABEL = { speaker: 'Speakers', moderator: 'Moderator', presentations: 'Presentations' };

  var CLOCK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#505561" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
  var TRACK_TAG_CLASSES = ['tag-energy', 'tag-industry', 'tag-markets', 'tag-finance', 'tag-policy'];

  /* -------- speaker modal --------
     One shared dialog (markup lives in index.html as #speaker-modal),
     populated and shown whenever a speaker's photo/name/card is clicked
     anywhere on the page (Speakers grid or an agenda session's credits). */

  var speakerModal = null;
  var speakerModalPreviouslyFocused = null;

  function getSpeakerModal() {
    if (!speakerModal) speakerModal = document.getElementById('speaker-modal');
    return speakerModal;
  }

  function openSpeakerModal(person) {
    var modal = getSpeakerModal();
    if (!modal || !person || !person.name) return;

    modal.querySelector('.speaker-modal__photo').src = person.photo;
    modal.querySelector('.speaker-modal__photo').alt = person.name;
    modal.querySelector('.speaker-modal__name').textContent = person.name;
    var roleLine = [person.jobTitle, person.company].filter(Boolean).join(', ');
    var roleEl = modal.querySelector('.speaker-modal__role');
    roleEl.textContent = roleLine;
    roleEl.style.display = roleLine ? '' : 'none';
    var bioEl = modal.querySelector('.speaker-modal__bio');
    if (person.bioHtml) {
      bioEl.innerHTML = person.bioHtml;
      bioEl.style.display = '';
    } else {
      bioEl.innerHTML = '';
      bioEl.style.display = 'none';
    }

    speakerModalPreviouslyFocused = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    var closeBtn = modal.querySelector('.speaker-modal__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeSpeakerModal() {
    var modal = getSpeakerModal();
    if (!modal || !modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (speakerModalPreviouslyFocused && speakerModalPreviouslyFocused.focus) {
      speakerModalPreviouslyFocused.focus();
    }
  }

  function initSpeakerModal() {
    var modal = getSpeakerModal();
    if (!modal) return;
    modal.querySelector('.speaker-modal__close').addEventListener('click', closeSpeakerModal);
    modal.querySelector('.speaker-modal__backdrop').addEventListener('click', closeSpeakerModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) closeSpeakerModal();
    });
  }

  // Wires a person card/row up to open the modal on click and Enter/Space,
  // and makes it look and behave like an interactive control.
  function makeClickableForModal(node, person) {
    if (!person || !person.name) return;
    node.classList.add('is-clickable');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.addEventListener('click', function () { openSpeakerModal(person); });
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSpeakerModal(person);
      }
    });
  }

  /* -------- building the session -> credited people index -------- */

  // registrationIndex: id -> registration record (from the speakers API)
  // relationships: raw array from content-relationships
  // Returns: sessionId -> { speaker: [person], moderator: [person], presentations: [person] }
  function buildCreditsIndex(relationships, registrationIndex) {
    var index = {};
    relationships.forEach(function (rel) {
      var left = rel.left, right = rel.right;
      if (!left || !right) return;
      if (left.type !== 'Session' || right.type !== 'Speaker') return;
      var reg = registrationIndex[right.contentId];
      if (!reg) return; // e.g. a hidden/unpublished profile
      var role = right.categoryId && ROLE_ORDER.indexOf(right.categoryId) !== -1 ? right.categoryId : 'speaker';
      var bucket = index[left.contentId] || (index[left.contentId] = { speaker: [], moderator: [], presentations: [] });
      bucket[role].push({ order: right.order || 0, person: personFromRegistration(reg) });
    });
    Object.keys(index).forEach(function (sessionId) {
      ROLE_ORDER.forEach(function (role) {
        index[sessionId][role].sort(function (a, b) { return a.order - b.order; }).forEach(function (x, i, arr) { arr[i] = x.person; });
      });
    });
    return index;
  }

  // One named row per credited person: photo, name, job title + company —
  // grouped under a "Speakers" / "Moderator" label, matching how the
  // client's reference design credits people on a session.
  function buildCreditRow(person) {
    var row = el('div', 'speaker-credit');
    var img = document.createElement('img');
    img.className = 'speaker-credit__photo';
    img.src = person.photo;
    img.alt = '';
    img.loading = 'lazy';
    row.appendChild(img);
    var info = el('div', 'speaker-credit__info');
    info.appendChild(text('span', 'speaker-credit__name', person.name));
    var roleLine = [person.jobTitle, person.company].filter(Boolean).join(', ');
    if (roleLine) info.appendChild(text('span', 'speaker-credit__role', roleLine));
    row.appendChild(info);
    makeClickableForModal(row, person);
    return row;
  }

  function buildCreditGroup(role, people) {
    var group = el('div', 'speaker-credit-group');
    group.appendChild(text('span', 'speaker-credit-group__label', ROLE_LABEL[role] || role));
    people.forEach(function (person) { group.appendChild(buildCreditRow(person)); });
    return group;
  }

  /* -------- agenda rendering -------- */

  function buildAgendaRow(session, creditsIndex) {
    var row = el('div', 'agenda-row');
    row.dataset.track = isBreakLike(session) ? 'networking' : 'plenary';

    var time = el('div', 'agenda-row__time');
    time.innerHTML = fmtTime(session.localStart) + (session.localEnd && session.localEnd !== session.localStart ? '<br>&ndash; ' + fmtTime(session.localEnd) : '');
    row.appendChild(time);

    if (isBreakLike(session)) {
      var brk = el('div', 'agenda-row__break');
      brk.innerHTML = CLOCK_ICON;
      brk.appendChild(document.createTextNode(' ' + session.name.trim()));
      row.appendChild(brk);
    } else {
      var card = el('div', 'card session-card');
      var tags = session.tags || [];
      var tagLabel = tags.indexOf('label:Plenary') !== -1 ? 'Main stage' : 'Session';
      card.appendChild(text('span', 'tag tag-main', tagLabel));
      card.appendChild(text('h3', null, session.name.trim()));
      var synopsis = (session.synopsisMd || '').trim();
      if (synopsis) {
        card.appendChild(text('p', 'session-card__desc clamp-2', synopsis));
      }
      appendCredits(card, session.id, creditsIndex);
      row.appendChild(card);
    }
    return row;
  }

  function appendCredits(card, sessionId, creditsIndex) {
    var group = creditsIndex[sessionId];
    if (!group) return;
    var wrap = el('div', 'session-card__speakers');
    var any = false;
    ROLE_ORDER.forEach(function (role) {
      if (group[role].length) {
        any = true;
        wrap.appendChild(buildCreditGroup(role, group[role]));
      }
    });
    if (any) card.appendChild(wrap);
  }

  function buildBreakoutGroup(breakout, tracks, creditsIndex) {
    var block = el('div', 'track-block');
    block.dataset.track = 'breakout';

    var head = el('div', 'track-block__head');
    var time = el('div', 'agenda-row__time');
    time.style.paddingTop = '0';
    time.innerHTML = fmtTime(breakout.localStart) + '<br>&ndash; ' + fmtTime(breakout.localEnd);
    head.appendChild(time);
    var h3 = el('h3', null);
    h3.appendChild(document.createTextNode(breakout.name.trim() + ' '));
    h3.appendChild(text('span', 'track-block__choose', '— choose your track'));
    head.appendChild(h3);
    block.appendChild(head);

    var cols = Math.min(Math.max(tracks.length, 1), 3);
    var grid = el('div', 'track-block__grid cols-' + cols);

    tracks.forEach(function (t, i) {
      t.sessions.forEach(function (session) {
        var cardEl = el('div', 'card track-card');
        var tagClass = TRACK_TAG_CLASSES[i % TRACK_TAG_CLASSES.length];
        cardEl.appendChild(text('span', 'tag ' + tagClass, t.track.name.trim()));
        cardEl.appendChild(text('h3', null, session.name.trim()));
        if (session.subtitle && session.subtitle.trim()) {
          cardEl.appendChild(text('p', 'session-card__desc', session.subtitle.trim()));
        }
        appendCredits(cardEl, session.id, creditsIndex);
        grid.appendChild(cardEl);
      });
    });

    block.appendChild(grid);
    return block;
  }

  function renderAgenda(agenda, creditsIndex) {
    var items = agenda.items || [];
    var breakouts = items.filter(function (i) { return i.type === 'Breakout'; });
    var breakoutTracks = items.filter(function (i) { return i.type === 'BreakoutTrack'; });
    var sessions = items.filter(function (i) { return i.type === 'Session'; });

    var tracksByBreakout = {};
    breakoutTracks.forEach(function (t) {
      (tracksByBreakout[t.breakoutId] = tracksByBreakout[t.breakoutId] || []).push(t);
    });
    Object.keys(tracksByBreakout).forEach(function (id) {
      tracksByBreakout[id].sort(function (a, b) { return a.order - b.order; });
    });

    var sessionsByTrackId = {};
    sessions.forEach(function (s) {
      if (s.trackId) (sessionsByTrackId[s.trackId] = sessionsByTrackId[s.trackId] || []).push(s);
    });

    var standalone = sessions.filter(function (s) { return !s.trackId; });

    // Build one combined, time-sorted timeline entry per day.
    var entries = [];
    standalone.forEach(function (s) {
      entries.push({ sortKey: s.localStart, day: dateKey(s.localStart), render: function () { return buildAgendaRow(s, creditsIndex); } });
    });
    breakouts.forEach(function (b) {
      var tracks = (tracksByBreakout[b.id] || []).map(function (t) {
        return { track: t, sessions: sessionsByTrackId[t.id] || [] };
      });
      entries.push({ sortKey: b.localStart, day: dateKey(b.localStart), render: function () { return buildBreakoutGroup(b, tracks, creditsIndex); } });
    });
    entries.sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0; });

    var days = [];
    entries.forEach(function (e) { if (days.indexOf(e.day) === -1) days.push(e.day); });
    days.sort();

    // Day tabs
    var dayToggle = document.getElementById('day-toggle');
    dayToggle.innerHTML = '';
    days.forEach(function (day, i) {
      var btn = el('button', 'day-toggle__btn' + (i === 0 ? ' is-active' : ''));
      btn.type = 'button';
      btn.dataset.day = day;
      btn.textContent = 'Day ' + (i + 1) + ' · ' + fmtDateLabel(day);
      dayToggle.appendChild(btn);
    });

    // Day panels
    var daysContainer = document.getElementById('agenda-days');
    daysContainer.innerHTML = '';
    days.forEach(function (day, i) {
      var panel = el('div', 'day-panel' + (i === 0 ? ' is-active' : ''));
      panel.dataset.dayPanel = day;
      entries.filter(function (e) { return e.day === day; }).forEach(function (e) {
        panel.appendChild(e.render());
      });
      daysContainer.appendChild(panel);
    });

    // Filter chips — built from whatever categories actually turned up.
    var present = {};
    daysContainer.querySelectorAll('[data-track]').forEach(function (n) { present[n.dataset.track] = true; });
    var chipDefs = [
      { slug: 'plenary', label: 'Main stage' },
      { slug: 'breakout', label: 'Breakout tracks' },
      { slug: 'networking', label: 'Networking' }
    ].filter(function (c) { return present[c.slug]; });

    var filters = document.getElementById('track-filters');
    filters.innerHTML = '';
    var allBtn = text('button', 'pill pill-dark is-active', 'All sessions');
    allBtn.type = 'button';
    allBtn.dataset.filter = 'all';
    filters.appendChild(allBtn);
    chipDefs.forEach(function (c) {
      var btn = text('button', 'pill pill-outline', c.label);
      btn.type = 'button';
      btn.dataset.filter = c.slug;
      filters.appendChild(btn);
    });

    wireAgendaControls();
  }

  function wireAgendaControls() {
    var dayButtons = document.querySelectorAll('#day-toggle [data-day]');
    var dayPanels = document.querySelectorAll('#agenda-days [data-day-panel]');
    dayButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        dayButtons.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        dayPanels.forEach(function (p) {
          p.classList.toggle('is-active', p.dataset.dayPanel === btn.dataset.day);
        });
      });
    });

    var filterButtons = document.querySelectorAll('#track-filters [data-filter]');
    filterButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        filterButtons.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        var filter = btn.dataset.filter;
        document.querySelectorAll('#agenda-days [data-track]').forEach(function (n) {
          n.classList.toggle('is-hidden', filter !== 'all' && n.dataset.track !== filter);
        });
      });
    });
  }

  /* -------- speakers directory -------- */

  function buildSpeakerCard(reg) {
    var person = personFromRegistration(reg);
    var card = el('div', 'speaker-card');

    var img = document.createElement('img');
    img.className = 'speaker-card__avatar';
    img.style.objectFit = 'cover';
    img.loading = 'lazy';
    img.alt = person.name;
    img.src = person.photo;
    card.appendChild(img);

    var meta = document.createElement('div');
    meta.appendChild(text('div', 'speaker-card__name', person.name));
    var roleParts = [person.jobTitle, person.company].filter(Boolean).join(', ');
    meta.appendChild(text('div', 'speaker-card__role', roleParts));
    card.appendChild(meta);

    makeClickableForModal(card, person);
    return card;
  }

  function renderSpeakers(registrations) {
    var grid = document.getElementById('speakers-grid');
    var status = document.getElementById('speakers-status');
    var visible = registrations
      .filter(function (r) { return r.profile && r.profile.profile_visible !== false; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    visible.forEach(function (reg) { grid.appendChild(buildSpeakerCard(reg)); });
    if (status) { status.remove(); }
  }

  /* -------- boot -------- */

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + url);
      return r.json();
    });
  }

  // Try the live API first; if it fails (cross-origin CORS block, network
  // error, etc.) fall back to the same-origin snapshot that
  // .github/workflows/refresh-data.yml keeps up to date. See the comment
  // block at the top of this file.
  function fetchWithFallback(liveUrl, snapshotPath) {
    return fetchJson(liveUrl).catch(function (err) {
      console.warn('Live fetch failed for ' + liveUrl + ', falling back to bundled snapshot (' + snapshotPath + '): ' + err.message);
      return fetchJson(snapshotPath);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initSpeakerModal();

    var agendaStatus = document.getElementById('agenda-status');
    var speakersStatus = document.getElementById('speakers-status');

    Promise.all([
      fetchWithFallback(AGENDA_API, 'data/agenda.json'),
      fetchWithFallback(SPEAKERS_API, 'data/speakers.json'),
      fetchWithFallback(RELATIONSHIPS_API, 'data/relationships.json').catch(function (err) {
        // Non-fatal: agenda still renders without speaker credits.
        console.warn('content-relationships unavailable (live and snapshot), agenda will render without speaker credits:', err);
        return [];
      })
    ]).then(function (results) {
      var agendaList = results[0];
      var registrations = results[1];
      var relationships = results[2];

      var agenda = agendaList[0];
      if (!agenda) throw new Error('empty agenda list');

      var registrationIndex = {};
      registrations.forEach(function (r) { registrationIndex[r.id] = r; });

      var creditsIndex = buildCreditsIndex(relationships, registrationIndex);

      renderAgenda(agenda, creditsIndex);
      agendaStatus.remove();

      renderSpeakers(registrations);
    }).catch(function (err) {
      var msg = 'Couldn’t load live data (' + err.message + '). See the CORS note at the top of assets/js/agenda.js.';
      agendaStatus.textContent = msg;
      speakersStatus.textContent = msg;
    });
  });

})();
