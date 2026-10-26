const read = (name: string): string => jest.requireActual('fs').readFileSync(name, 'utf8');

test('all seven app views use the native theme-inheriting host, including the required-content report', () => {
    const folder = 'src/main/resources/splunk/default/data/ui';
    const nav = new DOMParser().parseFromString(
        read(`${folder}/nav/default.xml`),
        'application/xml',
    );
    expect(nav.querySelector('parsererror')).toBeNull();
    expect(nav.querySelectorAll('view')).toHaveLength(7);
    expect(nav.querySelector('view[name="InUseContent"]')?.getAttribute('icon')).toBe('filechart');
    [
        'Overview',
        'CleanupCandidates',
        'DependencyExplorer',
        'InUseContent',
        'ReviewLibrary',
        'Ownership',
        'Settings',
    ].forEach((view) => {
        const host = new DOMParser().parseFromString(
            read(`${folder}/views/${view}.xml`),
            'application/xml',
        );
        expect(host.querySelector('parsererror')).toBeNull();
        expect(host.querySelector('dashboard')?.getAttribute('hideTitle')).toBe('true');
        expect(host.querySelector('dashboard')?.getAttribute('hideChrome')).toBe('false');
        expect(host.querySelectorAll('#content-hygiene-root')).toHaveLength(1);
    });
    expect(read('src/main/webapp/bootstrap.ts')).toContain("InUseContent: 'in-use-content'");
});

test('the legacy calculated-field Web route exposes only the exact native read catalog', () => {
    const config = read('src/main/resources/splunk/default/web.conf');
    const body = config.split('[expose:content_hygiene_calculated_field_catalog]')[1]?.split(/\n\[/)[0];
    expect(body).toBeDefined();
    expect(body).toMatch(/^pattern = data\/props\/calcfields$/m);
    expect(body).toMatch(/^methods = GET$/m);
    expect(body).not.toContain('*');
    expect(body).not.toMatch(/POST|DELETE|PUT|skipCSRFProtection|oidEnabled|allowRemoteProxy/);
    // No new Splunk capability, REST handler or source-content write role.
    expect(read('src/main/resources/splunk/default/authorize.conf')).not.toContain('calcfields');
    expect(read('src/main/resources/splunk/default/restmap.conf')).not.toContain('calcfields');
});
