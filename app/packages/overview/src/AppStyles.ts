import styled, { css } from 'styled-components';
import { mixins, variables } from '@splunk/themes';
import { HealthStatus, ReviewStage } from './types';

const statusColors: Record<HealthStatus, string> = {
    active: '#4fae58',
    dormant: '#e5a632',
    orphaned: '#db584c',
    broken: '#d83b3b',
    unowned: '#4f8ed8',
    protected: '#6c8ebf',
    unknown: '#8b949e',
};

export const StyledApp = styled.main`
    ${mixins.reset('block')};
    min-height: 100vh;
    box-sizing: border-box;
    background: ${variables.backgroundColorPage};
    color: ${variables.contentColorDefault};
    font-size: ${variables.fontSizeLarge};
`;

export const Page = styled.div`
    width: 100%;
    max-width: 1600px;
    margin: 0 auto;
    padding: ${variables.spacingXLarge};
    box-sizing: border-box;
`;

export const HeaderRow = styled.header`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: ${variables.spacingLarge};
    margin-bottom: ${variables.spacingLarge};

    @media (width <= 760px) {
        flex-direction: column;
    }
`;

export const Title = styled.h1`
    margin: 0;
    font-size: 28px;
    line-height: 1.25;
    font-weight: 600;
`;

export const Subtitle = styled.p`
    margin: ${variables.spacingXSmall} 0 0;
    color: ${variables.contentColorMuted};
    line-height: 1.5;
`;

export const ButtonRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${variables.spacingSmall};
`;

interface StyledButtonProps {
    $primary?: boolean;
}

export const StyledButton = styled.button<StyledButtonProps>`
    appearance: none;
    border: 1px solid
        ${({ $primary }) =>
            $primary ? variables.interactiveColorAccent : variables.interactiveColorBorder};
    border-radius: ${variables.borderRadius};
    background: ${({ $primary }) =>
        $primary ? variables.interactiveColorAccent : variables.interactiveColorBackground};
    color: ${({ $primary }) =>
        $primary ? variables.contentColorInverted : variables.contentColorDefault};
    cursor: pointer;
    min-height: 34px;
    padding: 6px 14px;
    font: inherit;
    font-weight: 500;

    &:hover {
        border-color: ${variables.interactiveColorBorderHover};
        filter: brightness(1.04);
    }

    &:focus-visible {
        outline: 2px solid ${variables.focusColor};
        outline-offset: 2px;
    }

    &:disabled {
        cursor: not-allowed;
        opacity: 0.55;
    }
`;

export const ScanBanner = styled.section`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${variables.spacingLarge};
    padding: ${variables.spacingMedium} ${variables.spacingLarge};
    margin-bottom: ${variables.spacingLarge};
    border: 1px solid ${variables.borderColor};
    border-left: 4px solid ${variables.contentColorPositive};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};

    @media (width <= 760px) {
        align-items: flex-start;
        flex-direction: column;
    }
`;

export const ScanMeta = styled.div`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${variables.spacingSmall};
    color: ${variables.contentColorMuted};
`;

export const SourceBadge = styled.span`
    display: inline-flex;
    align-items: center;
    border: 1px solid ${variables.contentColorInfo};
    border-radius: 999px;
    padding: 2px 8px;
    color: ${variables.contentColorInfo};
    font-size: ${variables.fontSizeSmall};
    font-weight: 600;
`;

export const MetricGrid = styled.section`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: ${variables.spacingMedium};
    margin-bottom: ${variables.spacingLarge};

    @media (width <= 1100px) {
        grid-template-columns: repeat(2, minmax(150px, 1fr));
    }

    @media (width <= 560px) {
        grid-template-columns: 1fr;
    }
`;

interface MetricCardProps {
    $accent?: 'positive' | 'warning' | 'negative' | 'info' | 'neutral';
}

const metricAccent = {
    positive: variables.contentColorPositive,
    warning: variables.contentColorWarning,
    negative: variables.contentColorNegative,
    info: variables.contentColorInfo,
    neutral: variables.contentColorDefault,
};

export const MetricCard = styled.article<MetricCardProps>`
    min-width: 0;
    padding: ${variables.spacingLarge};
    border: 1px solid ${variables.borderColor};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
    box-shadow: ${variables.overlayShadow};
    border-top: 3px solid
        ${({ $accent = 'neutral' }) => metricAccent[$accent]};
`;

export const MetricLabel = styled.div`
    color: ${variables.contentColorMuted};
    font-size: ${variables.fontSizeSmall};
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
`;

export const MetricValue = styled.div`
    margin-top: ${variables.spacingXSmall};
    font-size: 28px;
    font-weight: 600;
    line-height: 1.15;
`;

export const MetricHint = styled.div`
    margin-top: ${variables.spacingXSmall};
    color: ${variables.contentColorMuted};
    font-size: ${variables.fontSizeSmall};
    line-height: 1.4;
`;

export const TwoColumnGrid = styled.section`
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
    gap: ${variables.spacingLarge};

    @media (width <= 980px) {
        grid-template-columns: 1fr;
    }
`;

export const SpacedBlock = styled.div`
    margin-top: ${variables.spacingLarge};
`;

export const Card = styled.section`
    min-width: 0;
    overflow: hidden;
    border: 1px solid ${variables.borderColor};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
    box-shadow: ${variables.overlayShadow};
`;

export const CardHeader = styled.header`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${variables.spacingMedium};
    padding: ${variables.spacingLarge};
    border-bottom: 1px solid ${variables.borderColorWeak};
`;

export const CardTitle = styled.h2`
    margin: 0;
    font-size: ${variables.fontSizeXLarge};
    font-weight: 600;
`;

export const CardBody = styled.div`
    padding: ${variables.spacingLarge};
`;

export const FilterBar = styled.form`
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: ${variables.spacingMedium};
    margin-bottom: ${variables.spacingLarge};
    padding: ${variables.spacingLarge};
    border: 1px solid ${variables.borderColor};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
`;

export const FilterField = styled.label`
    display: grid;
    gap: ${variables.spacingXSmall};
    min-width: 150px;
    color: ${variables.contentColorMuted};
    font-size: ${variables.fontSizeSmall};
    font-weight: 600;
`;

const inputStyles = css`
    min-height: 34px;
    box-sizing: border-box;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: ${variables.borderRadius};
    background: ${variables.interactiveColorBackground};
    color: ${variables.contentColorDefault};
    padding: 6px 10px;
    font: inherit;

    &:focus {
        outline: 2px solid ${variables.focusColor};
        outline-offset: 1px;
    }
`;

export const Select = styled.select`
    ${inputStyles};
`;

export const Input = styled.input`
    ${inputStyles};
    min-width: 220px;
`;

export const TextArea = styled.textarea`
    ${inputStyles};
    width: 100%;
    min-height: 96px;
    resize: vertical;
`;

export const TableScroller = styled.div`
    overflow: auto;
`;

export const Table = styled.table`
    width: 100%;
    border-collapse: collapse;
    font-size: ${variables.fontSizeSmall};

    th,
    td {
        padding: 10px 12px;
        border-bottom: 1px solid ${variables.borderColorWeak};
        text-align: left;
        vertical-align: middle;
    }

    th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: ${variables.backgroundColorSection};
        color: ${variables.contentColorMuted};
        font-weight: 600;
        white-space: nowrap;
    }

    tbody tr:hover {
        background: ${variables.interactiveColorOverlayHover};
    }

    tbody tr:last-child td {
        border-bottom: 0;
    }
`;

export const RowButton = styled.button`
    border: 0;
    background: transparent;
    color: ${variables.contentColorLink};
    cursor: pointer;
    padding: 0;
    font: inherit;
    font-weight: 600;
    text-align: left;

    &:hover {
        text-decoration: underline;
    }

    &:focus-visible {
        outline: 2px solid ${variables.focusColor};
        outline-offset: 3px;
    }
`;

interface StatusBadgeProps {
    $status: HealthStatus;
}

export const StatusPill = styled.span<StatusBadgeProps>`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid ${({ $status }) => statusColors[$status]};
    border-radius: 999px;
    padding: 2px 8px;
    color: ${variables.contentColorDefault};
    font-size: ${variables.fontSizeSmall};
    font-weight: 600;
    white-space: nowrap;

    &::before {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: ${({ $status }) => statusColors[$status]};
        content: '';
    }
`;

export const Score = styled.span`
    display: inline-flex;
    align-items: center;
    min-width: 34px;
    border-radius: ${variables.borderRadius};
    padding: 2px 6px;
    background: ${variables.interactiveColorOverlaySelected};
    font-variant-numeric: tabular-nums;
    font-weight: 600;
`;

const reviewStageColors: Record<ReviewStage, string> = {
    triage: '#4f8ed8',
    investigating: '#e5a632',
    awaiting_owner: '#a970ff',
    confirmed_eligible: '#4fae58',
    retain: '#4f8ed8',
    blocked: '#d83b3b',
};

interface ReviewStagePillProps {
    $stage: ReviewStage;
}

export const ReviewStagePill = styled.span<ReviewStagePillProps>`
    display: inline-flex;
    align-items: center;
    border: 1px solid ${({ $stage }) => reviewStageColors[$stage]};
    border-radius: 999px;
    padding: 2px 8px;
    color: ${variables.contentColorDefault};
    font-size: ${variables.fontSizeSmall};
    font-weight: 600;
    white-space: nowrap;
`;

export const WorkflowForm = styled.form`
    display: grid;
    gap: ${variables.spacingMedium};
    margin-top: ${variables.spacingMedium};
`;

export const SmallText = styled.p`
    margin: ${variables.spacingXSmall} 0 0;
    color: ${variables.contentColorMuted};
    font-size: ${variables.fontSizeSmall};
    line-height: 1.45;
`;

export const Breadcrumbs = styled.nav`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${variables.spacingSmall};
    margin-bottom: ${variables.spacingMedium};
    color: ${variables.contentColorMuted};
    font-size: ${variables.fontSizeSmall};
`;

export const DetailLayout = styled.section`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
    gap: ${variables.spacingLarge};
    align-items: start;

    @media (width <= 1040px) {
        grid-template-columns: 1fr;
    }
`;

export const DetailPanel = styled.aside`
    position: sticky;
    top: ${variables.spacingLarge};
    border: 1px solid ${variables.borderColor};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
    box-shadow: ${variables.overlayShadow};

    @media (width <= 1040px) {
        position: static;
    }
`;

export const DetailSection = styled.section`
    padding: ${variables.spacingLarge};
    border-bottom: 1px solid ${variables.borderColorWeak};

    &:last-child {
        border-bottom: 0;
    }
`;

export const DetailTitle = styled.h2`
    margin: 0 0 ${variables.spacingSmall};
    font-size: ${variables.fontSizeXLarge};
`;

export const DefinitionList = styled.dl`
    display: grid;
    grid-template-columns: minmax(90px, 0.8fr) minmax(120px, 1.4fr);
    gap: ${variables.spacingSmall} ${variables.spacingMedium};
    margin: 0;

    dt {
        color: ${variables.contentColorMuted};
    }

    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }
`;

export const EvidenceList = styled.ul`
    display: grid;
    gap: ${variables.spacingSmall};
    margin: ${variables.spacingSmall} 0 0;
    padding-left: 20px;
    line-height: 1.45;
`;

export const EmptyState = styled.div`
    display: grid;
    place-items: center;
    min-height: 220px;
    padding: ${variables.spacingXXLarge};
    color: ${variables.contentColorMuted};
    text-align: center;
`;

export const CompositionRow = styled.div`
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(260px, 3fr) 90px;
    gap: ${variables.spacingMedium};
    align-items: center;
    margin-bottom: ${variables.spacingMedium};

    @media (width <= 680px) {
        grid-template-columns: 1fr;
        gap: ${variables.spacingXSmall};
    }
`;

export const CompositionBar = styled.div`
    display: flex;
    height: 16px;
    overflow: hidden;
    border-radius: 999px;
    background: ${variables.interactiveColorBackgroundDisabled};
`;

interface CompositionSegmentProps {
    $percent: number;
    $status: HealthStatus;
}

export const CompositionSegment = styled.span<CompositionSegmentProps>`
    display: block;
    width: ${({ $percent }) => `${$percent}%`};
    background: ${({ $status }) => statusColors[$status]};
`;

export const Legend = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${variables.spacingMedium};
    color: ${variables.contentColorMuted};
    font-size: ${variables.fontSizeSmall};
`;

interface LegendItemProps {
    $status: HealthStatus;
}

export const LegendItem = styled.span<LegendItemProps>`
    display: inline-flex;
    align-items: center;
    gap: 6px;

    &::before {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background: ${({ $status }) => statusColors[$status]};
        content: '';
    }
`;

export const GraphCanvas = styled.div`
    min-height: 510px;
    overflow: auto;
    padding: ${variables.spacingLarge};
    background:
        radial-gradient(circle at center, ${variables.interactiveColorOverlaySelected}, transparent 58%),
        ${variables.backgroundColorSection};
`;

export const GraphSvg = styled.svg`
    display: block;
    width: 100%;
    min-width: 720px;
    min-height: 470px;

    text {
        fill: ${variables.contentColorDefault};
        font-family: inherit;
    }

    .edge {
        stroke: ${variables.contentColorMuted};
        stroke-width: 1.5;
    }

    .edge-warning {
        stroke: ${variables.contentColorNegative};
        stroke-dasharray: 6 5;
    }

    .node {
        fill: ${variables.backgroundColorPage};
        stroke: ${variables.interactiveColorBorder};
        stroke-width: 1.5;
    }

    .node-selected {
        stroke: ${variables.contentColorInfo};
        stroke-width: 3;
    }
`;

export const InlineNotice = styled.div`
    padding: ${variables.spacingMedium} ${variables.spacingLarge};
    border: 1px solid ${variables.contentColorWarning};
    border-radius: ${variables.borderRadius};
    color: ${variables.contentColorDefault};
    line-height: 1.45;
`;

export const ProgressTrack = styled.div`
    width: 100%;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: ${variables.interactiveColorBackgroundDisabled};
`;

interface ProgressBarProps {
    $percent: number;
}

export const ProgressBar = styled.div<ProgressBarProps>`
    width: ${({ $percent }) => `${Math.max(0, Math.min(100, $percent))}%`};
    height: 100%;
    background: ${variables.interactiveColorAccent};
`;
