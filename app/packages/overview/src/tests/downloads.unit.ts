import { downloadCsv } from '../utils/downloadCsv';
import { downloadJson } from '../utils/downloadJson';

function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result)));
        reader.addEventListener('error', () => reject(reader.error));
        reader.readAsText(blob);
    });
}

function captureDownload(): {
    createObjectUrl: jest.Mock;
    createdAnchors: HTMLAnchorElement[];
} {
    const createObjectUrl = jest.fn(() => 'blob:content-hygiene-test');
    Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: jest.fn(),
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();
    const createdAnchors: HTMLAnchorElement[] = [];
    const createElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(
        (tagName: string): HTMLElement => {
            const element = createElement(tagName);
            if (tagName === 'a') {
                createdAnchors.push(element as HTMLAnchorElement);
            }
            return element;
        }
    );
    return { createObjectUrl, createdAnchors };
}

afterEach(() => {
    jest.restoreAllMocks();
});

test('creates an escaped CSV report download', async () => {
    const capture = captureDownload();

    downloadCsv(
        'candidates.csv',
        ['Name', 'Evidence'],
        [['Saved "Search"', 'owner, confirmed']]
    );

    const blob = capture.createObjectUrl.mock.calls[0][0] as Blob;
    expect(capture.createdAnchors[0].download).toBe('candidates.csv');
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(await readBlob(blob)).toBe(
        '"Name","Evidence"\n"Saved ""Search""","owner, confirmed"'
    );
});

test('creates a formatted JSON report download', async () => {
    const capture = captureDownload();

    downloadJson('reviews.json', {
        stage: 'confirmed_eligible',
        count: 1,
    });

    const blob = capture.createObjectUrl.mock.calls[0][0] as Blob;
    expect(capture.createdAnchors[0].download).toBe('reviews.json');
    expect(blob.type).toBe('application/json;charset=utf-8');
    expect(await readBlob(blob)).toBe(
        '{\n  "stage": "confirmed_eligible",\n  "count": 1\n}\n'
    );
});
