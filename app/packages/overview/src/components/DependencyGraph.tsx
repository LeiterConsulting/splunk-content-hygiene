import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Tooltip from '@splunk/react-ui/Tooltip';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { ButtonRow, FilterField, Select, SmallText, StyledButton } from '../AppStyles';
import {
    buildGraphModel,
    DependencyIndex,
    GRAPH_LABEL_HEIGHT,
    GRAPH_LABEL_WIDTH,
    GRAPH_NODE_HEIGHT,
    GRAPH_NODE_WIDTH,
    graphLinkPath,
} from '../services/dependencyGraph';
import { ContentObject, DependencyEdge } from '../types';
import { StatusBadge } from './StatusBadge';
import { GraphContext, GraphContextDialog } from './GraphContextDialog';

const Viewport = styled.div`
    position: relative;
    width: 100%;
    min-width: 0;
    height: min(65vh, 640px);
    min-height: 350px;
    overflow: auto;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorPage};
    overscroll-behavior: contain;
`;
const Artboard = styled.div<{ $width: number; $height: number; $zoom: number }>`
    position: relative;
    width: ${({ $width, $zoom }) => `${$width * $zoom}px`};
    height: ${({ $height, $zoom }) => `${$height * $zoom}px`};
    svg {
        position: absolute;
        inset: 0;
        overflow: visible;
        pointer-events: none;
        color: ${variables.contentColorDefault};
        z-index: 0;
    }
    path {
        fill: none;
        stroke: ${variables.contentColorDefault};
        stroke-width: 2;
    }
    marker path {
        fill: ${variables.contentColorDefault};
        stroke: none;
    }
    .uncertain {
        stroke-dasharray: 6 4;
    }
`;
const ColumnHeading = styled(SmallText)<{ $x: number; $zoom: number }>`
    position: absolute;
    left: ${({ $x, $zoom }) => `${$x * $zoom}px`};
    top: ${({ $zoom }) => `${16 * $zoom}px`};
    width: ${GRAPH_NODE_WIDTH}px;
    margin: 0;
    padding: ${variables.spacingXSmall};
    box-sizing: border-box;
    transform: ${({ $zoom }) => `scale(${$zoom})`};
    transform-origin: top left;
    z-index: 1;
    background: ${variables.backgroundColorPage};
    overflow-wrap: anywhere;
`;
const Node = styled.div<{ $selected: boolean; $x: number; $y: number; $zoom: number }>`
    position: absolute;
    left: ${({ $x, $zoom }) => `${$x * $zoom}px`};
    top: ${({ $y, $zoom }) => `${$y * $zoom}px`};
    width: ${GRAPH_NODE_WIDTH}px;
    height: ${GRAPH_NODE_HEIGHT}px;
    box-sizing: border-box;
    transform: ${({ $zoom }) => `scale(${$zoom})`};
    transform-origin: top left;
    border: ${({ $selected }) => ($selected ? 3 : 1)}px solid
        ${({ $selected }) => ($selected ? variables.contentColorLink : variables.interactiveColorBorder)};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
    padding: ${variables.spacingSmall};
    display: grid;
    z-index: 1;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: ${variables.spacingXSmall};
    button {
        min-width: 0;
        margin: 0;
    }
`;
const NodeFooter = styled.div`
    display: grid;
    justify-items: start;
    gap: ${variables.spacingXSmall};
    min-width: 0;
`;
const TooltipCopy = styled.div`
    max-width: 320px;
    white-space: normal;
    overflow-wrap: anywhere;
`;
const LinkLabel = styled.div<{ $x: number; $y: number; $zoom: number }>`
    position: absolute;
    left: ${({ $x, $zoom }) => `${$x * $zoom}px`};
    top: ${({ $y, $zoom }) => `${$y * $zoom}px`};
    width: ${GRAPH_LABEL_WIDTH}px;
    height: ${GRAPH_LABEL_HEIGHT}px;
    transform: ${({ $zoom }) => `scale(${$zoom})`};
    transform-origin: top left;
    z-index: 1;
    background: ${variables.backgroundColorSection};
    border-radius: ${variables.borderRadius};
    > span,
    > span > span {
        display: block;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
    }
`;
const RelationshipButton = styled(StyledButton)`
    && {
        margin: 0;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: ${variables.spacingSmall};
        background: ${variables.backgroundColorSection};
        border: 1px solid ${variables.interactiveColorBorder};
    }
    .relation {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.35;
    }
    .context-hint {
        display: block;
        margin-top: ${variables.spacingXSmall};
        font-size: ${variables.fontSizeSmall};
        white-space: normal;
    }
`;
const NodeSelect = styled(StyledButton).attrs({ appearance: 'standalone' as const })`
    &&,
    &&:hover,
    &&:focus,
    &&:active {
        color: ${variables.contentColorLink};
        background-color: transparent;
    }
    width: 100%;
    padding: 0;
    height: auto;
    text-align: left;
    align-self: start;
    line-height: 1.35;
    span {
        white-space: normal;
        overflow-wrap: anywhere;
    }
    .node-label {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: ${variables.spacingXSmall};
        min-width: 0;
        width: 100%;
    }
    .type {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        max-width: 100%;
        white-space: normal;
        overflow: hidden;
    }
    .name {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
`;

export function DependencyGraph({
    center,
    index,
    edges,
    inspectedId,
    onInspect,
    allows,
}: {
    center: ContentObject;
    index: DependencyIndex;
    edges: DependencyEdge[];
    inspectedId: string;
    onInspect: (id: string) => void;
    allows: (id: string, edge: DependencyEdge) => boolean;
}): React.ReactElement {
    const [grouping, setGrouping] = useState<'app' | 'type' | 'none'>('app');
    const [expandedGroups, setExpandedGroups] = useState(new Map<string, number>());
    const [expandedNodes, setExpandedNodes] = useState(new Set<string>());
    const [zoom, setZoom] = useState(1);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [contextSelection, setContextSelection] = useState<{
        kind: 'node' | 'link';
        id: string;
        open: boolean;
    } | null>(null);
    const contextTrigger = useRef<HTMLElement | null>(null);
    const viewport = useRef<HTMLDivElement>(null);
    const arrow = useId().replace(/:/g, '');
    const model = useMemo(
        () =>
            buildGraphModel(center.objectId, index, edges, {
                grouping,
                expandedGroups,
                expandedNodes,
                allows,
            }),
        [center.objectId, index, edges, grouping, expandedGroups, expandedNodes, allows],
    );
    const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model]);
    const linkById = useMemo(() => new Map(model.links.map((link) => [link.id, link])), [model]);
    const contextNode =
        contextSelection?.kind === 'node' ? nodeById.get(contextSelection.id) : null;
    const contextLink =
        contextSelection?.kind === 'link' ? linkById.get(contextSelection.id) : null;
    let context: GraphContext | null = null;
    if (contextNode) {
        context = { node: contextNode };
    } else if (contextLink) {
        context = { link: contextLink };
    }
    const showContext = (kind: 'node' | 'link', id: string): void => {
        contextTrigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPreviewId(null);
        setContextSelection({ kind, id, open: true });
    };
    const preview = (id: string): void => {
        if (!contextSelection?.open) { setPreviewId(id); }
    };
    const hidePreview = (id: string): void => {
        setPreviewId((current) => current === id ? null : current);
    };
    useEffect(() => {
        // Invalidate a dismissed selection once, so returning to an earlier
        // filter cannot reopen a dialog without a new user action. Its visible
        // context/open state is already derived above; unchanged paths stay open.
        if (contextSelection?.open && !contextNode && !contextLink) {
            setContextSelection((current) => current && { ...current, open: false });
        }
    }, [contextSelection?.open, contextNode, contextLink]);
    const fit = (): void => {
        setZoom(1);
        const node = nodeById.get(inspectedId) ?? nodeById.get(center.objectId);
        if (node && viewport.current) {
            viewport.current.scrollTo({
                left: Math.max(0, node.x - viewport.current.clientWidth / 2 + GRAPH_NODE_WIDTH / 2),
                top: Math.max(0, node.y - viewport.current.clientHeight / 2),
                behavior: 'smooth',
            });
        }
    };
    const columnTitle = (level: number): string => {
        if (level < 0) {
            return `Consumers · ${Math.abs(level)} hop(s)`;
        }
        return level > 0 ? `Dependencies · ${level} hop(s)` : 'Center object';
    };
    return (
        <>
            <ButtonRow>
                <FilterField>
                    Group high-degree relationships
                    <Select
                        value={grouping}
                        onChange={(event) =>
                            setGrouping(event.currentTarget.value as typeof grouping)
                        }
                    >
                        <option value="app">By app</option>
                        <option value="type">By object type</option>
                        <option value="none">Individual objects</option>
                    </Select>
                </FilterField>
                <StyledButton
                    onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))}
                    disabled={zoom <= 0.8}
                    aria-label="Zoom out graph"
                >
                    −
                </StyledButton>
                <StyledButton
                    onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
                    disabled={zoom >= 1.6}
                    aria-label="Zoom in graph"
                >
                    +
                </StyledButton>
                <StyledButton onClick={fit}>Fit selection</StyledButton>
                <StyledButton
                    onClick={() => {
                        setExpandedGroups(new Map());
                        setExpandedNodes(new Set());
                    }}
                >
                    Collapse expansions
                </StyledButton>
            </ButtonRow>
            <SmallText role="status">
                {model.representedObjects} objects represented ·{' '}
                {model.nodes.filter((node) => node.memberIds).length} groups ·{' '}
                {model.omittedObjects} omitted by the 60-card budget. Consumers appear to the left;
                dependencies appear to the right. Scroll or use arrow keys in the graph viewport to
                pan. Hover or focus a name or relationship for quick context. Choose Details or a
                relationship label for complete, selectable context without moving the graph center.
            </SmallText>
            <Viewport
                ref={viewport}
                role="region"
                aria-label={`Dependency graph centered on ${center.name}`}
                tabIndex={0}
            >
                <Artboard $width={model.width} $height={model.height} $zoom={zoom}>
                    <svg
                        width={model.width * zoom}
                        height={model.height * zoom}
                        viewBox={`0 0 ${model.width} ${model.height}`}
                        aria-hidden="true"
                    >
                        <defs>
                            <marker
                                id={arrow}
                                markerWidth="9"
                                markerHeight="9"
                                refX="9"
                                refY="4.5"
                                orient="auto"
                            >
                                <path d="M0,0 L9,4.5 L0,9 Z" />
                            </marker>
                        </defs>
                        {model.labels.map((label) => {
                            const { link } = label;
                            const source = nodeById.get(link.source)!;
                            const target = nodeById.get(link.target)!;
                            return (
                                <g key={link.id}>
                                    <path
                                        className={
                                            link.confidence === 'unknown' ||
                                            link.confidence === 'low'
                                                ? 'uncertain'
                                                : ''
                                        }
                                        d={graphLinkPath(source, target, label)}
                                        markerEnd={`url(#${arrow})`}
                                    />
                                </g>
                            );
                        })}
                    </svg>
                    {model.nodes
                        .filter(
                            (node, i, all) =>
                                all.findIndex((other) => other.level === node.level) === i,
                        )
                        .map((node) => (
                            <ColumnHeading key={node.level} $x={node.x} $zoom={zoom}>
                                {columnTitle(node.level)}
                            </ColumnHeading>
                        ))}
                    {model.labels.map(({ link, x, y }) => {
                        const relations = link.label.split(' · ');
                        const source = nodeById.get(link.source)!;
                        const target = nodeById.get(link.target)!;
                        return (
                            <LinkLabel
                                key={link.id}
                                $x={x}
                                $y={y}
                                $zoom={zoom}
                                data-graph-link={link.id}
                            >
                                <Tooltip
                                    open={!contextSelection?.open && previewId === `link:${link.id}`}
                                    onRequestOpen={() => preview(`link:${link.id}`)}
                                    onRequestClose={() => hidePreview(`link:${link.id}`)}
                                    content={
                                        <TooltipCopy data-content-hygiene-portal="true">
                                            <strong>
                                                {source.name} → {target.name}
                                            </strong>
                                            <div>
                                                {link.label} · {link.confidence} confidence
                                            </div>
                                            <div>Click or press Enter for full evidence.</div>
                                        </TooltipCopy>
                                    }
                                >
                                    <RelationshipButton
                                        aria-haspopup="dialog"
                                        aria-label={`Relationship context: ${link.label} from ${source.name} to ${target.name}`}
                                        onClick={() => showContext('link', link.id)}
                                    >
                                        <span>
                                            <span className="relation">{relations[0]}</span>
                                            <span className="context-hint">
                                                {relations.length > 1
                                                    ? `+${relations.length - 1} more · `
                                                    : ''}
                                                Details · {link.confidence}
                                            </span>
                                        </span>
                                    </RelationshipButton>
                                </Tooltip>
                            </LinkLabel>
                        );
                    })}
                    {model.nodes.map((node) => (
                        <Node
                            key={node.id}
                            $selected={node.id === inspectedId}
                            $x={node.x}
                            $y={node.y}
                            $zoom={zoom}
                            data-graph-node={node.id}
                        >
                            <Tooltip
                                open={!contextSelection?.open && previewId === `node:${node.id}`}
                                onRequestOpen={() => preview(`node:${node.id}`)}
                                onRequestClose={() => hidePreview(`node:${node.id}`)}
                                inline={false}
                                content={
                                    <TooltipCopy data-content-hygiene-portal="true">
                                        <strong>{node.name}</strong>
                                        <div>
                                            {node.objectType} · {node.app}
                                        </div>
                                        <div>
                                            {node.memberIds
                                                ? 'Select to show more members; Details lists the full group.'
                                                : 'Select to inspect, or choose Details to keep the graph in view.'}
                                        </div>
                                    </TooltipCopy>
                                }
                            >
                                <NodeSelect
                                    aria-label={
                                        node.groupKey
                                            ? `${node.name}: ${node.memberIds?.length} grouped objects`
                                            : `Inspect ${node.name}`
                                    }
                                    onClick={() =>
                                        node.groupKey
                                            ? setExpandedGroups((current) =>
                                                  new Map(current).set(
                                                      node.groupKey!,
                                                      (current.get(node.groupKey!) ?? 0) + 12,
                                                  ),
                                              )
                                            : onInspect(node.id)
                                    }
                                >
                                    <span className="node-label">
                                        <span className="name">{node.name}</span>
                                        <small className="type">{node.objectType}</small>
                                    </span>
                                </NodeSelect>
                            </Tooltip>
                            {node.groupKey ? (
                                <ButtonRow>
                                    <StyledButton
                                        onClick={() =>
                                            setExpandedGroups((current) =>
                                                new Map(current).set(
                                                    node.groupKey!,
                                                    (current.get(node.groupKey!) ?? 0) + 12,
                                                ),
                                            )
                                        }
                                    >
                                        Show up to 12 more
                                    </StyledButton>
                                    <StyledButton
                                        aria-haspopup="dialog"
                                        aria-label={`Full context for ${node.name}`}
                                        onClick={() => showContext('node', node.id)}
                                    >
                                        Details
                                    </StyledButton>
                                </ButtonRow>
                            ) : (
                                <NodeFooter>
                                    <ButtonRow>
                                        <StatusBadge status={node.status} />
                                        <StyledButton
                                            aria-haspopup="dialog"
                                            aria-label={`Full context for ${node.name}`}
                                            onClick={() => showContext('node', node.id)}
                                        >
                                            Details
                                        </StyledButton>
                                    </ButtonRow>
                                    {node.level !== 0 && node.resolved ? (
                                        <StyledButton
                                            disabled={Math.abs(node.level) >= 3}
                                            onClick={() =>
                                                setExpandedNodes((current) => {
                                                    const updated = new Set(current);
                                                    if (updated.has(node.id)) {
                                                        updated.delete(node.id);
                                                    } else {
                                                        updated.add(node.id);
                                                    }
                                                    return updated;
                                                })
                                            }
                                        >
                                            {expandedNodes.has(node.id) ? 'Collapse' : 'Expand'}
                                        </StyledButton>
                                    ) : null}
                                </NodeFooter>
                            )}
                        </Node>
                    ))}
                </Artboard>
            </Viewport>
            <GraphContextDialog
                key={`${contextSelection?.kind}:${contextSelection?.id}`}
                context={context}
                open={Boolean(contextSelection?.open && (contextNode || contextLink))}
                index={index}
                onClose={() =>
                    setContextSelection((current) => current && { ...current, open: false })
                }
                onInspect={onInspect}
                returnFocus={() => {
                    if (contextTrigger.current?.isConnected) {
                        contextTrigger.current.focus();
                    } else {
                        viewport.current?.focus();
                    }
                }}
            />
        </>
    );
}
