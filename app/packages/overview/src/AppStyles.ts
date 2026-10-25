import styled from 'styled-components';
import { mixins, variables } from '@splunk/themes';
import {
    ActionButton,
    ChoiceControl,
    TextControl,
    NotesControl,
    FieldControl,
    DataTable,
    Notice,
} from './components/SplunkControls';
import { HealthStatus, ReviewStage } from './types';

export const statusColors = {
    active: variables.statusColorNormalStrong,
    dormant: variables.statusColorMediumStrong,
    orphaned: variables.statusColorHighStrong,
    broken: variables.statusColorCriticalStrong,
    unowned: variables.statusColorInfoStrong,
    protected: variables.statusColorInfoStrong,
    unknown: variables.contentColorDefault,
};
export const StyledApp = styled.div`
    ${mixins.reset('block')};
    min-height: 100vh;
    box-sizing: border-box;
    background: ${variables.backgroundColorPage};
    color: ${variables.contentColorDefault};
    font-size: ${variables.fontSize};
    line-height: 1.5;
    [hidden] {
        display: none !important;
    }
    button:focus-visible,
    input:focus-visible,
    textarea:focus-visible,
    [tabindex]:focus-visible {
        outline: 3px solid ${variables.contentColorLink};
        outline-offset: 2px;
    }
`;

export const Page = styled.div`
    width: 100%;
    max-width: 1600px;
    margin: 0 auto;
    padding: ${variables.spacingLarge};
    box-sizing: border-box;
`;

export const HeaderRow = styled.header`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: ${variables.spacingLarge};
    margin-bottom: ${variables.spacingLarge};
    > div:first-child {
        min-width: 0;
        flex: 1;
    }

    @media (width <= 760px) {
        flex-direction: column;
    }
`;

export const Title = styled.h1`
    margin: 0;
    font-size: ${variables.fontSizeXXLarge};
    line-height: 1.25;
    font-weight: 600;
`;

export const Subtitle = styled.p`
    margin: ${variables.spacingXSmall} 0 0;
    color: ${variables.contentColorDefault};
    line-height: 1.5;
`;

export const ButtonRow = styled.div`
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: ${variables.spacingSmall};
    min-width: 0;
`;

// Transient styling props are not forwarded through styled-components to the
// adapter. Translate the primary intent before that filtering takes place.
export const StyledButton = styled(ActionButton).attrs(({ $primary, appearance }) => ({
    appearance: $primary ? 'primary' as const : appearance,
}))`
    margin: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
`;

export const ScanBanner = styled.section<{ $state?: 'ready' | 'warning' | 'error' | 'unknown' }>`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${variables.spacingLarge};
    padding: ${variables.spacingMedium} ${variables.spacingLarge};
    margin-bottom: ${variables.spacingLarge};
    border: 1px solid ${variables.borderColor};
    border-left: 4px solid ${({ $state }) => {
        if ($state === 'ready') { return variables.statusColorNormalStrong; }
        if ($state === 'warning') { return variables.statusColorHighStrong; }
        if ($state === 'error') { return variables.statusColorCriticalStrong; }
        return variables.contentColorDefault;
    }};
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
    color: ${variables.contentColorDefault};
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
    positive: variables.statusColorNormalStrong,
    warning: variables.statusColorHighStrong,
    negative: variables.statusColorCriticalStrong,
    info: variables.statusColorInfoStrong,
    neutral: variables.contentColorDefault,
};

export const MetricCard = styled.article<MetricCardProps>`
    min-width: 0;
    padding: ${variables.spacingLarge};
    border: 1px solid ${variables.borderColor};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
    border-top: 3px solid ${({ $accent = 'neutral' }) => metricAccent[$accent]};
`;

export const MetricLabel = styled.div`
    color: ${variables.contentColorDefault};
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
    color: ${variables.contentColorDefault};
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

export const StackedContent = styled.div`
    display: grid;
    gap: ${variables.spacingLarge};
`;

export const Card = styled.section`
    min-width: 0;
    overflow: hidden;
    border: 1px solid ${variables.borderColor};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
`;

export const CardHeader = styled.header`
    display: flex;
    flex-wrap: wrap;
    min-width: 0;
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
    .center-object-picker {
        flex: 2 1 300px;
    }
`;

export const FilterField = styled(FieldControl)`
    min-width: 0;
    flex: 1 1 180px;
    max-width: 100%;
    margin: 0;
    label {
        color: ${variables.contentColorDefault};
    }
`;
export const Select = styled(ChoiceControl)`
    min-width: 0;
    width: 100%;
    max-width: 100%;
    margin: 0;
`;
export const Input = styled(TextControl)`
    min-width: 0;
    width: 100%;
    max-width: 100%;
    margin: 0;
`;
export const TextArea = styled(NotesControl)`
    width: 100%;
    min-width: 0;
    max-width: 100%;
`;

export const TableScroller = styled.div`
    overflow: auto;
    max-width: 100%;
    min-width: 0;
`;

export const Table = styled(DataTable)`
    max-width: 100%;

    /* Keep a readable identifier column even beside an investigation panel.
       The native Table scrolls within its card instead of squeezing long
       object/app names into one- or two-character lines. */
    th,
    td {
        min-width: 96px;
    }
    th:first-child,
    td:first-child {
        min-width: 240px;
    }
    &.candidate-selection-table th:first-child,
    &.candidate-selection-table td:first-child {
        min-width: 48px;
        width: 48px;
    }
    &.candidate-selection-table th:nth-child(2),
    &.candidate-selection-table td:nth-child(2) {
        min-width: 240px;
    }
    th {
        color: ${variables.contentColorDefault};
    }
    td {
        overflow-wrap: anywhere;
    }
`;
export const RowButton = styled(ActionButton).attrs({ appearance: 'standalone' as const })`
    &&,
    &&:hover,
    &&:focus,
    &&:active {
        color: ${variables.contentColorLink};
        background-color: transparent;
    }
    margin: 0;
    padding: 0;
    height: auto;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 2px;
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
    background: ${variables.backgroundColorSection};
    font-variant-numeric: tabular-nums;
    font-weight: 600;
`;

const reviewStageColors = {
    triage: variables.statusColorInfoStrong,
    investigating: variables.statusColorMediumStrong,
    awaiting_owner: variables.statusColorMediumStrong,
    confirmed_eligible: variables.statusColorNormalStrong,
    retain: variables.statusColorInfoStrong,
    blocked: variables.statusColorCriticalStrong,
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
    max-width: 1000px;
`;

export const SmallText = styled.p`
    margin: ${variables.spacingXSmall} 0 0;
    color: ${variables.contentColorDefault};
    font-size: ${variables.fontSizeSmall};
    line-height: 1.45;
`;

export const Breadcrumbs = styled.nav`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${variables.spacingSmall};
    margin-bottom: ${variables.spacingMedium};
    color: ${variables.contentColorDefault};
    font-size: ${variables.fontSizeSmall};
`;

export const DetailLayout = styled.section`
    min-width: 0;
    > * {
        min-width: 0;
    }
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: ${variables.spacingLarge};
    align-items: start;

`;

export const DetailPanel = styled.aside`
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    scroll-margin-top: ${variables.spacingLarge};
    border: 1px solid ${variables.borderColor};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
`;

export const WorkspaceHeader = styled.header`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: ${variables.spacingMedium};
    padding: ${variables.spacingLarge};
    border-bottom: 1px solid ${variables.borderColorWeak};
    > div:first-child {
        flex: 1 1 300px;
        min-width: 0;
    }
`;

export const WorkspaceNavigation = styled.nav`
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: ${variables.spacingSmall};
    margin-bottom: ${variables.spacingMedium};
`;

export const WorkspacePanel = styled.div`
    min-width: 0;
    padding: ${variables.spacingLarge};
    &[hidden] {
        display: none;
    }
`;

export const ReviewFields = styled.div`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: ${variables.spacingMedium};
    max-width: 1000px;
    @media (width <= 680px) {
        grid-template-columns: minmax(0, 1fr);
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
    display: inline-block;
    max-width: 100%;
    overflow-wrap: anywhere;
    margin: 0 0 ${variables.spacingSmall};
    font-size: ${variables.fontSizeXLarge};
`;

export const DefinitionList = styled.dl`
    min-width: 0;
    max-width: 1100px;
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.4fr);
    gap: ${variables.spacingSmall} ${variables.spacingMedium};
    margin: 0;

    dt {
        color: ${variables.contentColorDefault};
    }

    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }
`;

export const FactGrid = styled(DefinitionList)`
    max-width: none;
    grid-template-columns: repeat(2, minmax(120px, 0.6fr) minmax(0, 1fr));
    gap: ${variables.spacingSmall} ${variables.spacingLarge};
    @media (width <= 1000px) {
        grid-template-columns: minmax(120px, 0.6fr) minmax(0, 1.4fr);
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
    color: ${variables.contentColorDefault};
    text-align: center;
`;

interface CompositionRowProps {
    $selected?: boolean;
}

export const CompositionRow = styled.div<CompositionRowProps>`
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(260px, 3fr) 90px;
    gap: ${variables.spacingMedium};
    align-items: center;
    margin: 0 -${variables.spacingSmall};
    padding: ${variables.spacingSmall};
    border-radius: ${variables.borderRadius};
    background: ${({ $selected }) =>
        $selected ? variables.interactiveColorOverlaySelected : 'transparent'};

    @media (width <= 680px) {
        grid-template-columns: 1fr;
        gap: ${variables.spacingXSmall};
    }
`;

export const CompositionBar = styled.button`
    display: flex;
    width: 100%;
    height: 16px;
    overflow: hidden;
    appearance: none;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: ${variables.interactiveColorBackgroundDisabled};
    cursor: pointer;

    &:hover {
        outline: 1px solid ${variables.contentColorDefault};
        outline-offset: 2px;
    }

    &:focus-visible {
        outline: 2px solid ${variables.focusColor};
        outline-offset: 3px;
    }
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

export const CompositionControls = styled.form`
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(170px, 1fr) auto auto;
    gap: ${variables.spacingSmall};
    align-items: end;
    margin-bottom: ${variables.spacingMedium};

    input,
    select {
        width: 100%;
        min-width: 0;
    }

    @media (width <= 760px) {
        grid-template-columns: 1fr 1fr;
    }

    @media (width <= 520px) {
        grid-template-columns: 1fr;
    }
`;

export const CompositionControl = styled(FilterField)`
    min-width: 0;
`;

export const CompositionPagination = styled.nav`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${variables.spacingMedium};
    margin-top: ${variables.spacingMedium};
    padding-top: ${variables.spacingMedium};
    border-top: 1px solid ${variables.borderColorWeak};

    @media (width <= 620px) {
        align-items: flex-start;
        flex-direction: column;
    }
`;

export const CompositionSummary = styled.span`
    color: ${variables.contentColorDefault};
    font-size: ${variables.fontSizeSmall};
    font-variant-numeric: tabular-nums;
`;

export const CompositionDetails = styled.section`
    margin-top: ${variables.spacingMedium};
    padding: ${variables.spacingMedium};
    border: 1px solid ${variables.borderColorWeak};
    border-radius: ${variables.borderRadius};
    background: ${variables.interactiveColorOverlaySelected};
`;

export const CompositionDetailsHeader = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${variables.spacingMedium};
    margin-bottom: ${variables.spacingSmall};

    strong {
        overflow-wrap: anywhere;
    }
`;

export const CompositionMetricGrid = styled.dl`
    display: grid;
    grid-template-columns: repeat(5, minmax(90px, 1fr));
    gap: ${variables.spacingSmall};
    margin: 0;

    div {
        min-width: 0;
    }

    dt {
        color: ${variables.contentColorDefault};
        font-size: ${variables.fontSizeSmall};
    }

    dd {
        margin: 2px 0 0;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
    }

    @media (width <= 700px) {
        grid-template-columns: repeat(2, minmax(90px, 1fr));
    }
`;

export const Legend = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${variables.spacingMedium};
    color: ${variables.contentColorDefault};
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
        radial-gradient(
            circle at center,
            ${variables.interactiveColorOverlaySelected},
            transparent 58%
        ),
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
        stroke: ${variables.contentColorDefault};
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

export const InlineNotice = styled(Notice)`
    width: 100%;
    box-sizing: border-box;
    overflow-wrap: anywhere;
    line-height: 1.5;
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
    background: ${variables.statusColorInfoStrong};
`;
