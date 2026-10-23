import React from 'react';
import Paginator from '@splunk/react-ui/Paginator';
import { ButtonRow, SmallText } from '../AppStyles';

export function ResultPagination({
    page,
    pageSize,
    total,
    onChange,
}: {
    page: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
}): React.ReactElement {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(page, totalPages - 1);
    return (
        <ButtonRow>
            <SmallText role="status">
                {total ? current * pageSize + 1 : 0}–{Math.min((current + 1) * pageSize, total)} of{' '}
                {total}
            </SmallText>
            <Paginator.Compact
                current={current + 1}
                totalPages={totalPages}
                renderLabel
                onChange={(_event, data) => onChange((data.page ?? 1) - 1)}
            />
        </ButtonRow>
    );
}
