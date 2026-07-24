import {
    AnalysisCompleteness,
    RawAnalysisSource,
    analyzeInventory,
    extractDashboardReferences,
    extractSplReferences,
} from '../services/analysis';
import { ContentObject } from '../types';

const completeCoverage: AnalysisCompleteness = {
    macros: true,
    lookup_definitions: true,
    lookup_files: true,
    saved_searches: true,
    data_models: true,
    indexes: true,
    sourcetypes: true,
};

function object(
    overrides: Partial<ContentObject> & Pick<ContentObject, 'objectId' | 'canonicalName'>
): ContentObject {
    return {
        name: overrides.canonicalName,
        objectType: 'Saved Search',
        app: 'search',
        owner: 'analyst',
        sharing: 'app',
        enabled: true,
        scheduled: false,
        updated: '2025-01-01T00:00:00Z',
        lastUsed: null,
        healthStatus: 'unknown',
        abandonmentConfidence: null,
        removalImpact: null,
        inboundReferences: 0,
        outboundReferences: 0,
        protected: false,
        evidence: ['Collected from Splunk REST'],
        suggestedAction: 'Collect evidence',
        ...overrides,
    };
}

test('extracts supported SPL relationships without treating dynamic names as static', () => {
    const references = extractSplReferences(
        '| inputlookup assets.csv | lookup owner_lookup user | `normalize_user(user)` | savedsearch "Daily Review" | datamodel Authentication Authentication search | search index=main sourcetype=access_combined | lookup $dynamic_lookup$ key | search index=_* sourcetype=access_* | lookup generated_* key'
    );

    expect(references).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                targetType: 'lookup',
                targetName: 'assets.csv',
                relation: 'reads',
            }),
            expect.objectContaining({
                targetType: 'lookup',
                targetName: 'owner_lookup',
                relation: 'reads',
            }),
            expect.objectContaining({
                targetType: 'macro',
                targetName: 'normalize_user',
            }),
            expect.objectContaining({
                targetType: 'saved_search',
                targetName: 'Daily Review',
            }),
            expect.objectContaining({
                targetType: 'data_model',
                targetName: 'Authentication',
            }),
            expect.objectContaining({
                targetType: 'index',
                targetName: 'main',
            }),
            expect.objectContaining({
                targetType: 'sourcetype',
                targetName: 'access_combined',
            }),
        ])
    );
    expect(
        references.some(
            (reference) =>
                reference.targetName.includes('dynamic') ||
                reference.targetName.includes('*') ||
                reference.targetName === '_'
        )
    ).toBe(false);
});

test('ignores command-like text and field constraints inside string literals', () => {
    const references = extractSplReferences(
        '| eval search_type="datamodel acceleration" | eval example="index=retired sourcetype=missing" | search index=main'
    );

    expect(references).toEqual([
        expect.objectContaining({
            targetType: 'index',
            targetName: 'main',
        }),
    ]);
});

test('extracts structured and inline dashboard relationships', () => {
    const references = extractDashboardReferences(`
        <dashboard>
            <search ref="Daily Review" />
            <search><query>index=main | lookup assets.csv host</query></search>
        </dashboard>
    `);

    expect(references).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                targetType: 'saved_search',
                targetName: 'Daily Review',
                confidence: 'high',
            }),
            expect.objectContaining({
                targetType: 'index',
                targetName: 'main',
            }),
            expect.objectContaining({
                targetType: 'lookup',
                targetName: 'assets.csv',
            }),
        ])
    );
});

test('persists resolved edges and marks explicit missing targets as repair findings', () => {
    const source = object({
        objectId: 'saved_search::search::retired_review',
        canonicalName: 'retired_review',
        enabled: false,
    });
    const macro = object({
        objectId: 'macro::search::normalize_user(1)',
        canonicalName: 'normalize_user(1)',
        objectType: 'Macro',
    });
    const sources: RawAnalysisSource[] = [
        {
            objectId: source.objectId,
            kind: 'spl',
            text: '| `normalize_user(user)` | lookup missing_assets host',
            sourceLocation: 'search',
        },
    ];

    const result = analyzeInventory(
        [source, macro],
        sources,
        completeCoverage
    );
    const analyzedSource = result.objects.find(
        (contentObject) => contentObject.objectId === source.objectId
    );

    expect(result.edges).toHaveLength(2);
    expect(result.edges).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                targetId: macro.objectId,
                resolved: true,
            }),
            expect.objectContaining({
                targetId: expect.stringContaining('missing::lookup'),
                resolved: false,
            }),
        ])
    );
    expect(analyzedSource?.healthStatus).toBe('broken');
    expect(result.findings).toEqual([
        expect.objectContaining({
            objectId: source.objectId,
            findingType: 'repair_required',
        }),
    ]);
});

test('resolves same-name private targets within the source owner namespace', () => {
    const source = object({
        objectId: 'saved_search::search::user:analyst::private_review',
        canonicalName: 'private_review',
        owner: 'analyst',
        sharing: 'user',
    });
    const analystMacro = object({
        objectId: 'macro::search::user:analyst::private_filter',
        canonicalName: 'private_filter',
        objectType: 'Macro',
        owner: 'analyst',
        sharing: 'user',
    });
    const reviewerMacro = object({
        objectId: 'macro::search::user:reviewer::private_filter',
        canonicalName: 'private_filter',
        objectType: 'Macro',
        owner: 'reviewer',
        sharing: 'user',
    });

    const result = analyzeInventory(
        [source, analystMacro, reviewerMacro],
        [
            {
                objectId: source.objectId,
                kind: 'spl',
                text: '| `private_filter`',
                sourceLocation: 'search',
            },
        ],
        completeCoverage
    );

    expect(result.edges[0]).toEqual(
        expect.objectContaining({
            targetId: analystMacro.objectId,
            resolved: true,
        })
    );
});

test('does not call a target broken when collector coverage is partial', () => {
    const source = object({
        objectId: 'saved_search::search::disabled_review',
        canonicalName: 'disabled_review',
        enabled: false,
    });
    const partialCoverage = {
        ...completeCoverage,
        lookup_definitions: false,
    };
    const result = analyzeInventory(
        [source],
        [
            {
                objectId: source.objectId,
                kind: 'spl',
                text: '| lookup missing_assets host',
                sourceLocation: 'search',
            },
        ],
        partialCoverage
    );

    expect(result.edges[0]).toEqual(
        expect.objectContaining({
            confidence: 'unknown',
            resolved: false,
        })
    );
    expect(result.objects[0].healthStatus).toBe('dormant');
    expect(
        result.findings.some(
            (findingValue) => findingValue.findingType === 'repair_required'
        )
    ).toBe(false);
});

test('keeps an unresolved sourcetype unknown when its catalog is non-authoritative', () => {
    const source = object({
        objectId: 'saved_search::search::configured_source_review',
        canonicalName: 'configured_source_review',
        enabled: true,
    });
    const nonAuthoritativeSourcetypes = {
        ...completeCoverage,
        sourcetypes: false,
    };
    const result = analyzeInventory(
        [source],
        [
            {
                objectId: source.objectId,
                kind: 'spl',
                text: 'sourcetype=configured_but_inactive',
                sourceLocation: 'search',
            },
        ],
        nonAuthoritativeSourcetypes
    );

    expect(result.edges[0]).toEqual(
        expect.objectContaining({
            confidence: 'unknown',
            resolved: false,
        })
    );
    expect(result.objects[0].healthStatus).toBe('unknown');
    expect(result.findings).toHaveLength(0);
});

test('protected objects cannot become cleanup findings', () => {
    const protectedObject = object({
        objectId: 'saved_search::system::internal_health',
        canonicalName: 'internal_health',
        app: 'system',
        owner: null,
        sharing: 'app',
        enabled: false,
        protected: true,
        healthStatus: 'protected',
    });

    const result = analyzeInventory(
        [protectedObject],
        [],
        completeCoverage
    );

    expect(result.objects[0].healthStatus).toBe('protected');
    expect(result.objects[0].abandonmentConfidence).toBeNull();
    expect(result.findings).toHaveLength(0);
});

test('does not infer an ownership gap when Splunk omits ACL scope metadata', () => {
    const unknownAclObject = object({
        objectId: 'index::search::customer_events',
        canonicalName: 'customer_events',
        objectType: 'Index',
        owner: null,
        sharing: null,
    });

    const result = analyzeInventory(
        [unknownAclObject],
        [],
        completeCoverage
    );

    expect(result.objects[0].healthStatus).toBe('unknown');
    expect(
        result.findings.some(
            (findingValue) => findingValue.findingType === 'unowned'
        )
    ).toBe(false);
});

test('identifies a true user-scoped object without an owner', () => {
    const unownedObject = object({
        objectId: 'saved_search::search::private_review',
        canonicalName: 'private_review',
        owner: null,
        sharing: 'user',
    });

    const result = analyzeInventory(
        [unownedObject],
        [],
        completeCoverage
    );

    expect(result.objects[0].healthStatus).toBe('unowned');
    expect(result.findings).toEqual([
        expect.objectContaining({
            objectId: unownedObject.objectId,
            findingType: 'unowned',
        }),
    ]);
});
