import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SplunkThemeProvider } from '@splunk/themes';
import { RowButton, Table, TableScroller } from '../AppStyles';

afterEach(cleanup);

test.each(['light', 'dark'] as const)(
    'native tables retain readable column widths and object actions in %s mode',
    (colorScheme) => {
        const onInspect = jest.fn();
        render(
            <SplunkThemeProvider family="enterprise" colorScheme={colorScheme}>
                <TableScroller>
                    <Table>
                        <thead><tr><th>Object</th><th>Type</th><th>Owner</th></tr></thead>
                        <tbody>
                            <tr>
                                <td>
                                    <RowButton onClick={onInspect}>A_long_object_identifier_that_must_remain_readable</RowButton>
                                    <div>technical_namespace</div>
                                </td>
                                <td>Saved Search</td><td>App scope</td>
                            </tr>
                        </tbody>
                    </Table>
                </TableScroller>
            </SplunkThemeProvider>,
        );
        const table = screen.getByRole('table');
        const cells = within(table).getAllByRole('cell');
        const heads = within(table).getAllByRole('columnheader');
        expect(getComputedStyle(cells[0]).minWidth).toBe('240px');
        expect(getComputedStyle(heads[0]).minWidth).toBe('240px');
        expect(getComputedStyle(cells[1]).minWidth).toBe('96px');
        expect(getComputedStyle(heads[1]).minWidth).toBe('96px');
        expect(within(cells[0]).getByRole('button')).toHaveAccessibleName(
            'A_long_object_identifier_that_must_remain_readable',
        );
        const content = cells[0].querySelector('[data-content-hygiene-cell]');
        expect(content).toContainElement(within(cells[0]).getByRole('button'));
        expect(content).toContainElement(within(cells[0]).getByText('technical_namespace'));
        expect(getComputedStyle(content!).display).toBe('block');
        expect(table.parentElement).toHaveAttribute('data-test', 'scroll-container');
    },
);
