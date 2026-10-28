// Synthetic focus-target contract; no customer source or native records.
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSelectionFocus } from '../components/useSelectionFocus';

function Workspace({ listContainer }: { listContainer: boolean }) {
    const [selected, setSelected] = useState('');
    const { detailTitle, listTitle } = useSelectionFocus(selected, listContainer);
    return <>
        {selected ? <section data-investigation-workspace aria-label="Detail container">
            <h2 ref={detailTitle} tabIndex={-1}>Selected witness</h2>
            <button type="button" onClick={() => setSelected('')}>Close witness</button>
        </section> : null}
        <section data-investigation-workspace aria-label="Results container">
            <h2 ref={listTitle} tabIndex={-1}>Results</h2>
            <button type="button" onClick={() => setSelected('witness')}>Inspect witness</button>
        </section>
    </>;
}

test.each([false, true])('container scroll opt-in %s preserves focus and the existing default', async listContainer => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const targets: HTMLElement[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value(this: HTMLElement) { targets.push(this); } });
    try {
        const user = userEvent.setup(); render(<Workspace listContainer={listContainer} />);
        expect(targets).toHaveLength(0);
        await user.click(screen.getByRole('button', { name: 'Inspect witness' }));
        expect(screen.getByRole('heading', { name: 'Selected witness' })).toHaveFocus();
        expect(targets[0]).toBe(screen.getByRole('region', { name: 'Detail container' }));
        await user.click(screen.getByRole('button', { name: 'Close witness' }));
        expect(screen.getByRole('heading', { name: 'Results' })).toHaveFocus();
        const expected = listContainer ? screen.getByRole('region', { name: 'Results container' }) : screen.getByRole('heading', { name: 'Results' });
        expect(targets[1]).toBe(expected);
    } finally {
        if (descriptor) { Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor); }
        else { Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'); }
    }
});
