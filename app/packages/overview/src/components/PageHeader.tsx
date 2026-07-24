import React, { ReactNode } from 'react';
import { HeaderRow, Subtitle, Title } from '../AppStyles';

interface PageHeaderProps {
    title: string;
    subtitle: string;
    actions?: ReactNode;
}

export function PageHeader({
    title,
    subtitle,
    actions,
}: PageHeaderProps): React.ReactElement {
    return (
        <HeaderRow>
            <div>
                <Title>{title}</Title>
                <Subtitle>{subtitle}</Subtitle>
            </div>
            {actions}
        </HeaderRow>
    );
}
