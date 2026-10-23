// The workspace test command runs from this package. Keep Node-only resource
// loading in Jest, without adding Node globals to the browser's type contract.
const css: string = jest.requireActual('fs').readFileSync(
    'src/main/resources/splunk/appserver/static/content-hygiene-host.css', 'utf8');

beforeEach(() => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
});
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); });

test('collapses the empty host header without hiding native navigation or workspace content', () => {
    document.body.innerHTML = `
        <nav id="native-nav">Splunk navigation</nav>
        <div class="dashboard-body">
            <div class="dashboard-header" id="empty-header"></div>
            <div id="content_hygiene_host_row"><div id="content-hygiene-root">Workspace</div></div>
        </div>`;
    expect(getComputedStyle(document.getElementById('empty-header')!).display).toBe('none');
    expect(getComputedStyle(document.getElementById('native-nav')!).display).not.toBe('none');
    expect(getComputedStyle(document.getElementById('content-hygiene-root')!).display).not.toBe('none');
});

test('retains a header with content and does not style another dashboard', () => {
    document.body.innerHTML = `
        <div class="dashboard-body">
            <div class="dashboard-header" id="nonempty-header"><button>Host action</button></div>
            <div id="content_hygiene_host_row"></div>
        </div>
        <div class="dashboard-body"><div class="dashboard-header" id="other-header"></div></div>`;
    expect(getComputedStyle(document.getElementById('nonempty-header')!).display).not.toBe('none');
    expect(getComputedStyle(document.getElementById('other-header')!).display).not.toBe('none');
});

test('corrects tagged portal inputs without changing native host inputs', () => {
    document.body.innerHTML = `
        <div style="color: rgb(235, 240, 245)">
            <input data-content-hygiene-filter="true" id="portal-filter" />
            <input id="native-filter" />
        </div>`;
    const portal = getComputedStyle(document.getElementById('portal-filter')!);
    const native = getComputedStyle(document.getElementById('native-filter')!);
    expect(portal.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(portal.borderTopWidth).toBe('0px');
    expect(native.backgroundColor).not.toBe(portal.backgroundColor);
    expect(native.borderTopWidth).not.toBe('0px');
});
