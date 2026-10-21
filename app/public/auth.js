// Login UI. The server is the security boundary (see functions/api/login.js); this only keeps
// the token and hides controls. The token lives in localStorage — survives browser restarts —
// and is sent as `Authorization: Bearer <token>`, never as a cookie: between this site and the
// API a cookie is third-party in some configurations and Safari blocks it outright.
const KEY = 'recipes:token';

const authToken = () => localStorage.getItem(KEY);

// Anything marked data-requires-auth is hidden by CSS until body has .logged-in.
const render = (loggedIn) => {
  document.body.classList.toggle('logged-in', loggedIn);
  nav.innerHTML = loggedIn
    ? '<button type="button">Log out</button>'
    : '<form><input type="password" name="password" placeholder="Password" required><button>Log in</button></form>';
  if (loggedIn) nav.firstChild.onclick = () => (localStorage.removeItem(KEY), render(false));
  else nav.firstChild.onsubmit = logIn;
};

const logIn = async (event) => {
  event.preventDefault();
  // The JSON content type is deliberate: it makes this a preflighted request rather than a CORS
  // simple request, so another origin cannot fire password guesses at it without a preflight.
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: event.target.password.value }),
  });
  if (!response.ok) return alert('Wrong password');
  localStorage.setItem(KEY, (await response.json()).token);
  render(true);
};

const nav = document.querySelector('.site-header').appendChild(document.createElement('span'));
nav.className = 'auth';

// Render from the stored token at once, so a returning writer sees no login-form flash, then let
// the server confirm it — the password may have been rotated since. Downgrade if it says no.
render(Boolean(authToken()));
if (authToken())
  fetch('/api/session', { headers: { Authorization: `Bearer ${authToken()}` } }).then((response) => {
    if (response.ok) return;
    localStorage.removeItem(KEY);
    render(false);
  });
