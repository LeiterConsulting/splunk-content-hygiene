import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Tooltip from '@splunk/react-ui/Tooltip';
import Modal from '@splunk/react-ui/Modal';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { ButtonRow, FilterField, Select, SmallText, StyledButton } from '../AppStyles';
import {
    buildGraphModel,
    DependencyIndex,
    GRAPH_NODE_BUDGET,
    GRAPH_MAX_HOPS,
    GraphNode,
    graphLinkPath,
} from '../services/dependencyGraph';
import { connectionGraph, fitGraphZoom, graphAssociation, GraphWindow, investigatedPathGraph, PresentationNode, viewportGraph } from '../services/graphPresentation';
import { ContentObject, DependencyEdge } from '../types';
import { StatusBadge } from './StatusBadge';
import { GraphContext, GraphContextDialog } from './GraphContextDialog';

const Viewport = styled.div<{ $maximized: boolean }>`
    position: relative;
    width: 100%;
    min-width: 0;
    height: ${({ $maximized }) => $maximized ? '100%' : 'min(65vh, 640px)'};
    min-height: ${({ $maximized }) => $maximized ? '240px' : '350px'};
    flex: 1 1 auto;
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
    path[data-graph-highlighted='true'] {
        stroke: ${variables.contentColorLink};
        stroke-width: 4;
    }
    marker.active path {
        fill: ${variables.contentColorLink};
    }
    marker path {
        fill: ${variables.contentColorDefault};
        stroke: none;
    }
    .uncertain {
        stroke-dasharray: 6 4;
    }
`;
const ColumnHeading = styled(SmallText)<{ $x: number; $zoom: number; $width: number }>`
    position: absolute;
    left: ${({ $x, $zoom }) => `${$x * $zoom}px`};
    top: ${({ $zoom }) => `${16 * $zoom}px`};
    width: ${({ $width }) => $width}px;
    margin: 0;
    padding: ${variables.spacingXSmall};
    box-sizing: border-box;
    transform: ${({ $zoom }) => `scale(${$zoom})`};
    transform-origin: top left;
    z-index: 1;
    background: ${variables.backgroundColorPage};
    overflow-wrap: anywhere;
`;
const Node = styled.div<{ $selected: boolean; $active: boolean; $x: number; $y: number; $zoom: number; $width: number; $height: number; $compact: boolean }>`
    position: absolute;
    left: ${({ $x, $zoom }) => `${$x * $zoom}px`};
    top: ${({ $y, $zoom }) => `${$y * $zoom}px`};
    width: ${({ $width }) => $width}px;
    height: ${({ $height }) => $height}px;
    box-sizing: border-box;
    transform: ${({ $zoom }) => `scale(${$zoom})`};
    transform-origin: top left;
    border: ${({ $selected }) => ($selected ? 3 : 1)}px solid
        ${({ $selected }) => ($selected ? variables.contentColorLink : variables.interactiveColorBorder)};
    border-radius: ${variables.borderRadius};
    outline: ${({ $active }) => $active ? 2 : 0}px solid ${variables.contentColorLink};
    outline-offset: 2px;
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
    && .name {
        -webkit-line-clamp: ${({ $compact }) => $compact ? 2 : 3};
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
const LinkLabel = styled.div<{ $x: number; $y: number; $zoom: number; $width: number; $height: number; $active: boolean; $compact: boolean }>`
    position: absolute;
    left: ${({ $x, $zoom }) => `${$x * $zoom}px`};
    top: ${({ $y, $zoom }) => `${$y * $zoom}px`};
    width: ${({ $width }) => $width}px;
    height: ${({ $height }) => $height}px;
    transform: ${({ $zoom }) => `scale(${$zoom})`};
    transform-origin: top left;
    z-index: 1;
    background: ${variables.backgroundColorSection};
    border-radius: ${variables.borderRadius};
    outline: ${({ $active }) => $active ? 2 : 0}px solid ${variables.contentColorLink};
    outline-offset: 2px;
    && .relation {
        -webkit-line-clamp: ${({ $compact }) => $compact ? 1 : 2};
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
    .endpoints {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        overflow-wrap: anywhere;
        font-size: ${variables.fontSizeSmall};
        line-height: 1.3;
        margin-top: ${variables.spacingXSmall};
    }
`;
const GraphWorkspace = styled.div<{ $maximized: boolean }>`
    display: flex;
    flex-direction: column;
    gap: ${({ $maximized }) => $maximized ? variables.spacingXSmall : variables.spacingSmall};
    min-width: 0;
    min-height: 0;
    height: 100%;
`;
const FullWindowHeader = styled(Modal.Header)`
    padding: ${variables.spacingSmall} ${variables.spacingMedium};
`;
const FullWindowBody = styled(Modal.Body)`
    padding: ${variables.spacingSmall};
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
`;
const ConnectionSummary = styled(SmallText)`
    margin: 0;
    overflow-wrap: anywhere;
    min-height: 1.5em;
    max-height: 4.5em;
    overflow: auto;
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
    const [expandedGroups, setExpandedGroups] = useState(() => new Map<string, number>());
    const [expandedBranches, setExpandedBranches] = useState(() => new Set<string>());
    const [collapsedNodes, setCollapsedNodes] = useState(() => new Set<string>());
    const [expandAll, setExpandAll] = useState(false);
    const expandedNodes = useMemo(() => new Set<string>(), []);
    const [zoom, setZoom] = useState(1);
    const [maximized, setMaximized] = useState(false);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [pageOffsets, setPageOffsets] = useState(() => new Map<number, number>());
    const [browseOpen, setBrowseOpen] = useState(false);
    const [focusEdgeId, setFocusEdgeId] = useState<string | null>(null);
    const [focusPathEdges, setFocusPathEdges] = useState<DependencyEdge[] | null>(null);
    const mapCamera = useRef<{ left: number; top: number; zoom: number } | null>(null);
    const [hovered, setHovered] = useState<{ kind: 'node' | 'link'; id: string } | null>(null);
    const [focused, setFocused] = useState<{ kind: 'node' | 'link'; id: string } | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [contextSelection, setContextSelection] = useState<{
        kind: 'node' | 'link';
        id: string;
        open: boolean;
    } | null>(null);
    const contextTrigger = useRef<HTMLElement | null>(null);
    const viewport = useRef<HTMLDivElement | null>(null);
    const maximizeTrigger = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
    const camera = useRef<{ kind: 'relative'; x: number; y: number } | { kind: 'node'; id: string } | { kind: 'scroll'; left: number; top: number } | null>({ kind: 'node', id: center.objectId });
    const arrow = useId().replace(/:/g, '');
    const neighborhood = useMemo(
        () =>
            buildGraphModel(center.objectId, index, edges, {
                grouping,
                expandedGroups,
                expandedNodes,
                expandedBranches,
                collapsedNodes,
                expandAll,
                allows,
            }),
        [center.objectId, index, edges, grouping, expandedGroups, expandedNodes, expandedBranches, collapsedNodes, expandAll, allows],
    );
    const allReferences = useMemo(() => [...new Map(neighborhood.links.flatMap(link => link.edges).map(edge => [edge.edgeId, edge])).values()], [neighborhood]);
    const referenceConfidence = useMemo(() => {
        const rank: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
        return allReferences.reduce((weakest, edge) => (rank[edge.confidence] ?? 0) < (rank[weakest] ?? 0) ? edge.confidence : weakest, allReferences[0]?.confidence ?? 'unknown');
    }, [allReferences]);
    const focusedReference = focusEdgeId ? allReferences.find(edge => edge.edgeId === focusEdgeId) : null;
    const focusModel = useMemo(() => {
        if (focusPathEdges) { return investigatedPathGraph(focusPathEdges, index); }
        return focusedReference ? connectionGraph(focusedReference, index) : null;
    }, [focusPathEdges, focusedReference, index]);
    const model = useMemo(() => viewportGraph(focusModel ?? neighborhood, { ...viewportSize, zoom, offsets: pageOffsets }), [focusModel, neighborhood, viewportSize, zoom, pageOffsets]);
    const { mode, geometry } = model;
    const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model]);
    const linkById = useMemo(() => new Map(model.links.map((link) => [link.id, link])), [model]);
    const contextNode =
        contextSelection?.kind === 'node' ? nodeById.get(contextSelection.id) : null;
    const contextLink =
        contextSelection?.kind === 'link' ? linkById.get(contextSelection.id) : null;
    const active = useMemo(() => contextSelection?.open && (contextNode || contextLink) ? contextSelection : hovered ?? focused ??
        (focusedReference ? { kind: 'link' as const, id: model.links[0].id } : null), [contextSelection, contextNode, contextLink, hovered, focused, focusedReference, model.links]);
    const association = useMemo(() => focusPathEdges && !active ? { nodes: new Set(model.nodes.map(node => node.id)), links: new Set(model.links.map(link => link.id)) } : graphAssociation({ ...model, links: model.labels.map(label => label.link) }, active), [model, active, focusPathEdges]);
    const activeLink = active?.kind === 'link' ? linkById.get(active.id) : null;
    const activeNode = active?.kind === 'node' ? nodeById.get(active.id) : null;
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
    const focusAssociation = (kind: 'node' | 'link', id: string): void => {
        // A stationary pointer must not mask a new keyboard focus. A later
        // pointer enter can take over; leaving it restores the focused context.
        setHovered(null);
        setFocused({ kind, id });
    };
    const applyCamera = useCallback((element: HTMLDivElement | null): void => {
        viewport.current = element;
        const saved = camera.current;
        if (!element || !saved) { return; }
        let left = 0; let top = 0;
        if (saved.kind === 'scroll') { left = saved.left; top = saved.top; }
        if (saved.kind === 'relative') {
            left = saved.x * model.width * zoom - element.clientWidth / 2;
            top = saved.y * model.height * zoom - element.clientHeight / 2;
        }
        if (saved.kind === 'node') {
            const node = nodeById.get(saved.id) ?? nodeById.get(center.objectId) ?? model.nodes[0];
            left = (node.x + geometry.nodeWidth / 2) * zoom - element.clientWidth / 2;
            top = (node.y + geometry.nodeHeight / 2) * zoom - element.clientHeight / 2;
        }
        Object.assign(element, { scrollLeft: Math.max(0, left), scrollTop: Math.max(0, top) });
        camera.current = null;
    }, [model.width, model.height, model.nodes, zoom, nodeById, center.objectId, geometry]);
    useEffect(() => { applyCamera(viewport.current); }, [applyCamera, maximized]);
    useEffect(() => {
        const element = viewport.current;
        if (!element) { return undefined; }
        const measure = (): void => {
            const width = element.clientWidth; const height = element.clientHeight;
            setViewportSize(current => current.width === width && current.height === height ? current : { width, height });
        };
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        observer?.observe(element);
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
    }, [maximized]);
    useEffect(() => {
        if (focusEdgeId && !focusedReference) { setFocusEdgeId(null); mapCamera.current = null; }
    }, [focusEdgeId, focusedReference]);
    useEffect(() => {
        if (focusPathEdges?.some(edge => index.edgeById.get(edge.edgeId) !== edge)) { setFocusPathEdges(null); mapCamera.current = null; }
    }, [focusPathEdges, index]);
    const focusConnection = (edge: DependencyEdge): void => {
        const element = viewport.current;
        if (!focusedReference && !focusPathEdges) { mapCamera.current = { left: element?.scrollLeft ?? 0, top: element?.scrollTop ?? 0, zoom }; }
        setContextSelection(null); setBrowseOpen(false); setPreviewId(null); setHovered(null); setFocused(null);
        camera.current = { kind: 'relative', x: 0.5, y: 0.5 };
        setZoom(Math.min(1, fitGraphZoom(connectionGraph(edge, index), element?.clientWidth || 1000, element?.clientHeight || 620)));
        setFocusEdgeId(edge.edgeId);
        setFocusPathEdges(null);
        element?.focus();
    };
    const focusPath = (path: DependencyEdge[]): void => {
        if (!path.length || path.length > 32) { return; }
        const element = viewport.current;
        if (!focusedReference && !focusPathEdges) { mapCamera.current = { left: element?.scrollLeft ?? 0, top: element?.scrollTop ?? 0, zoom }; }
        setContextSelection(null); setBrowseOpen(false); setPreviewId(null); setHovered(null); setFocused(null); setFocusEdgeId(null);
        setFocusPathEdges(path);
        camera.current = { kind: 'relative', x: 0.5, y: 0.5 };
        setZoom(Math.min(1, fitGraphZoom(investigatedPathGraph(path, index), element?.clientWidth || 1000, element?.clientHeight || 620)));
        element?.focus();
    };
    const returnToMap = (): void => {
        const saved = mapCamera.current;
        if (saved) { camera.current = { kind: 'scroll', left: saved.left, top: saved.top }; setZoom(saved.zoom); }
        mapCamera.current = null; setFocusEdgeId(null); setFocusPathEdges(null); setHovered(null); setFocused(null); setPreviewId(null);
        viewport.current?.focus();
    };
    const turnPage = (page: GraphWindow, direction: -1 | 1): void => {
        camera.current = { kind: 'node', id: center.objectId };
        viewport.current?.focus();
        setPageOffsets(current => new Map(current).set(page.level, Math.max(0, page.start + direction * page.pageSize)));
    };
    const changeZoom = (value: number): void => {
        const nextZoom = Math.max(0.6, Math.min(1.6, Math.round(value * 10) / 10));
        if (nextZoom === zoom) { return; }
        const element = viewport.current;
        if (element) {
            camera.current = { kind: 'relative', x: (element.scrollLeft + element.clientWidth / 2) / (model.width * zoom),
                y: (element.scrollTop + element.clientHeight / 2) / (model.height * zoom) };
        }
        setZoom(nextZoom);
    };
    const toggleMaximized = useCallback((value: boolean): void => {
        if (viewport.current) { camera.current = { kind: 'scroll', left: viewport.current.scrollLeft, top: viewport.current.scrollTop }; }
        setPreviewId(null); setHovered(null); setFocused(null); setMaximized(value);
    }, []);
    const closeMaximized = useCallback(() => toggleMaximized(false), [toggleMaximized]);
    const returnMaximizedFocus = useCallback(() => maximizeTrigger.current?.focus(), []);
    const expandBranch = (id: string, currentlyExpanded: boolean): void => {
        camera.current = { kind: 'node', id };
        setExpandedBranches(current => {
            const next = new Set(current); if (currentlyExpanded) { next.delete(id); } else { next.add(id); } return next;
        });
        setCollapsedNodes(current => {
            const next = new Set(current); if (currentlyExpanded) { next.add(id); } else { next.delete(id); } return next;
        });
    };
    const revealGroup = (groupKey: string): void => {
        camera.current = { kind: 'node', id: center.objectId };
        viewport.current?.focus();
        setExpandedGroups(current => new Map(current).set(groupKey, (current.get(groupKey) ?? 0) + 12));
    };
    const preview = (id: string): void => {
        if (!contextSelection?.open && !browseOpen) { setPreviewId(id); }
    };
    const hidePreview = (id: string): void => {
        setPreviewId((current) => current === id ? null : current);
    };
    const returnContextFocus = useCallback(() => {
        if (contextTrigger.current?.isConnected) {
            contextTrigger.current.focus();
        } else {
            viewport.current?.focus();
        }
    }, []);
    useEffect(() => {
        // Invalidate a dismissed selection once, so returning to an earlier
        // filter cannot reopen a dialog without a new user action. Its visible
        // context/open state is already derived above; unchanged paths stay open.
        if (contextSelection?.open && !contextNode && !contextLink) {
            setContextSelection(null);
            returnContextFocus();
        }
    }, [contextSelection?.open, contextNode, contextLink, returnContextFocus]);
    const fit = (): void => {
        if (!nodeById.has(inspectedId) && !focusedReference && !focusPathEdges) {
            const edge = allReferences.find(row => row.sourceId === inspectedId || row.targetId === inspectedId);
            if (edge) { focusConnection(edge); return; }
        }
        camera.current = { kind: 'node', id: inspectedId };
        setZoom(1);
        if (zoom === 1) { applyCamera(viewport.current); }
    };
    const columnTitle = (level: number): string => {
        if (focusPathEdges) { return `Selected path · step ${level + 1}`; }
        if (focusedReference) { return level === 0 ? 'From object' : 'To object'; }
        if (level < 0) {
            return `Consumers · ${Math.abs(level)} hop(s)`;
        }
        return level > 0 ? `Dependencies · ${level} hop(s)` : 'Center object';
    };
    const branchHint = (node: GraphNode): string => {
        if (Math.abs(node.level) >= GRAPH_MAX_HOPS) { return 'Three-hop display limit; center on this object to investigate further.'; }
        if (node.canExpand) { return 'A shared object may also remain visible through another expanded branch.'; }
        return 'No further captured relationships in this direction.';
    };
    const branchControl = (node: GraphNode): React.ReactNode => {
        if (focusedReference || focusPathEdges || node.level === 0 || !node.resolved) { return null; }
        if (!node.canExpand) { return <SmallText>{Math.abs(node.level) >= GRAPH_MAX_HOPS ? '3-hop display limit · inspect to re-center' : 'End of captured branch'}</SmallText>; }
        return <StyledButton aria-label={`${node.expanded ? 'Collapse' : 'Expand'} branch for ${node.name}`}
            title={branchHint(node)} onClick={() => expandBranch(node.id, Boolean(node.expanded))}>
            {node.expanded ? 'Collapse branch' : 'Expand branch'}
        </StyledButton>;
    };
    const selectNode = (node: PresentationNode): void => {
        if (node.continuation) { showContext('node', node.id); }
        else if (node.groupKey) { revealGroup(node.groupKey); }
        else { onInspect(node.id); }
    };
    const nodeFooter = (node: PresentationNode): React.ReactNode => {
        if (node.continuation) {
            const page = node.continuation;
            return <NodeFooter>
                <SmallText>{page.pageSize ? `Cards ${page.start + 1}–${page.end} of ${page.total}` : 'Use Details or Browse connections to focus an endpoint.'}</SmallText>
                <ButtonRow>
                    {page.pageSize ? <>
                        <StyledButton aria-label={`Previous object cards at hop ${node.level}`} disabled={!page.start}
                            onClick={() => turnPage(page, -1)}>Previous</StyledButton>
                        <StyledButton aria-label={`Next object cards at hop ${node.level}`} disabled={page.end >= page.total}
                            onClick={() => turnPage(page, 1)}>Next</StyledButton>
                    </> : null}
                    <StyledButton aria-haspopup="dialog" aria-label={`Full context for ${node.name}`} onClick={() => showContext('node', node.id)}>Details</StyledButton>
                </ButtonRow>
            </NodeFooter>;
        }
        if (node.groupKey) {
            return <ButtonRow>
                <StyledButton onClick={() => revealGroup(node.groupKey!)}>Show up to 12 more</StyledButton>
                {expandedGroups.has(node.groupKey) ? <StyledButton onClick={() => {
                    camera.current = { kind: 'node', id: center.objectId };
                    viewport.current?.focus();
                    setExpandedGroups(current => { const next = new Map(current); next.delete(node.groupKey!); return next; });
                }}>Collapse group</StyledButton> : null}
                <StyledButton aria-haspopup="dialog" aria-label={`Full context for ${node.name}`} onClick={() => showContext('node', node.id)}>Details</StyledButton>
            </ButtonRow>;
        }
        return <NodeFooter>
            <ButtonRow>
                <StatusBadge status={node.status} />
                <StyledButton aria-haspopup="dialog" aria-label={`Full context for ${node.name}`} onClick={() => showContext('node', node.id)}>Details</StyledButton>
            </ButtonRow>
            {branchControl(node)}
        </NodeFooter>;
    };
    let connectionSummary: React.ReactNode = maximized ? 'Hover or focus a relationship box to identify its connection and endpoints.' :
        'Choose a relationship box for full evidence. Expand branch follows only that branch; shared objects may remain visible through another branch.';
    if (activeLink) {
        connectionSummary = <><strong>Connection: </strong>{nodeById.get(activeLink.source)?.name} → <strong>{activeLink.label}</strong> → {nodeById.get(activeLink.target)?.name}</>;
    } else if (activeNode) {
        connectionSummary = <><strong>Object: </strong>{activeNode.name} · {association.links.size} displayed connection(s)</>;
    }
    let graphView = focusedReference ? 'connection' : 'map';
    if (focusPathEdges) { graphView = 'path'; }
    const workspace = (
        <GraphWorkspace $maximized={maximized} data-graph-workspace="true" data-graph-density={mode} data-graph-view={graphView}>
            <ButtonRow>
                {focusedReference || focusPathEdges ? <StyledButton $primary onClick={returnToMap}>Return to map</StyledButton> : <FilterField>
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
                </FilterField>}
                <StyledButton aria-haspopup="dialog" onClick={() => {
                    contextTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    setPreviewId(null); setContextSelection(null); setBrowseOpen(true);
                }}>Browse connections ({allReferences.length})</StyledButton>
                <StyledButton
                    onClick={() => changeZoom(zoom - 0.1)}
                    disabled={zoom <= 0.6}
                    aria-label="Zoom out graph"
                >
                    −
                </StyledButton>
                <StyledButton
                    onClick={() => changeZoom(zoom + 0.1)}
                    disabled={zoom >= 1.6}
                    aria-label="Zoom in graph"
                >
                    +
                </StyledButton>
                <StyledButton aria-label="Reset graph zoom to 100 percent" onClick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</StyledButton>
                <StyledButton onClick={fit}>Fit selection</StyledButton>
                <StyledButton onClick={() => {
                    const element = viewport.current;
                    if (!element) { return; }
                    camera.current = { kind: 'relative', x: 0.5, y: 0.5 };
                    const value = fitGraphZoom(model, element.clientWidth, element.clientHeight);
                    setZoom(value); if (value === zoom) { applyCamera(element); }
                }}>Fit graph</StyledButton>
                {focusedReference || focusPathEdges ? null : <StyledButton onClick={() => {
                    camera.current = { kind: 'node', id: center.objectId };
                    const groups = new Map(expandedGroups);
                    neighborhood.nodes.forEach(node => { if (node.groupKey) { groups.set(node.groupKey, GRAPH_NODE_BUDGET); } });
                    setExpandedGroups(groups); setCollapsedNodes(new Set()); setPageOffsets(new Map()); setExpandAll(true);
                }}>Expand all</StyledButton>}
                {focusedReference || focusPathEdges ? null : <StyledButton
                    onClick={() => {
                        camera.current = { kind: 'node', id: center.objectId };
                        setExpandedGroups(new Map());
                        setExpandedBranches(new Set()); setCollapsedNodes(new Set()); setExpandAll(false); setPageOffsets(new Map());
                    }}
                >
                    Collapse all
                </StyledButton>}
                <StyledButton elementRef={maximizeTrigger} aria-haspopup={maximized ? undefined : 'dialog'} onClick={() => toggleMaximized(!maximized)}>
                    {maximized ? 'Exit full screen' : 'Full screen graph'}
                </StyledButton>
            </ButtonRow>
            <SmallText role="status">
                {focusedReference ? <>Connection focus · exact captured reference. Map center remains {center.name}. </> : null}
                {focusPathEdges ? <>Path focus · {focusPathEdges.length} ordered captured hop(s). Map center remains {center.name}; wider paths may require horizontal panning. </> : null}
                {focusPathEdges ? 'Only this selected path is drawn; other dependencies remain in the cached graph and full reports. ' : <>{model.representedObjects} objects represented ·{' '}
                {model.nodes.filter((node) => node.memberIds).length} groups ·{' '}
                {model.omittedObjects} omitted by the {GRAPH_NODE_BUDGET}-card budget. Expansion stops at {GRAPH_MAX_HOPS} hops;
                {model.expansionLimited ? ' expansion work limit reached; use filters or center on a branch.' : ''}
                {model.windows.length ? ` ${model.windows.length} hop column(s) paged to this viewport; continuation groups retain all off-page references. ` : ' '}
                {model.hiddenLinks ? `${model.labels.length} of ${model.links.length} map connections drawn; browse connections for every captured reference. ` : ''}
                {maximized ? ' Hover or focus a connection to highlight its endpoints.' : <>
                    Grouped or deeper objects remain in the relationship reports. {mode === 'overview' ? 'Overview cards adapt to crowding, viewport size and zoom. ' : 'Detailed cards in this viewport. '}
                    Consumers are left; dependencies are right. Hover or focus a box to highlight its exact connection and endpoints. Scroll or use arrow keys to pan.
                </>}</>}
            </SmallText>
            <ConnectionSummary aria-label="Highlighted graph context">
                {connectionSummary}
            </ConnectionSummary>
            <Viewport
                ref={applyCamera}
                $maximized={maximized}
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
                            <marker id={`${arrow}-active`} className="active" markerWidth="9" markerHeight="9" refX="9" refY="4.5" orient="auto">
                                <path d="M0,0 L9,4.5 L0,9 Z" />
                            </marker>
                        </defs>
                        {[...model.labels].sort((a, b) => Number(association.links.has(a.link.id)) - Number(association.links.has(b.link.id))).map((label) => {
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
                                        data-graph-path={link.id}
                                        data-graph-highlighted={association.links.has(link.id)}
                                        d={graphLinkPath(source, target, label, geometry)}
                                        markerEnd={`url(#${arrow}${association.links.has(link.id) ? '-active' : ''})`}
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
                            <ColumnHeading key={node.level} $x={node.x} $zoom={zoom} $width={geometry.nodeWidth}>
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
                                $width={geometry.labelWidth}
                                $height={geometry.labelHeight}
                                $compact={mode === 'overview' || model.compactLabels}
                                $active={association.links.has(link.id)}
                                data-graph-link={link.id}
                                data-graph-highlighted={association.links.has(link.id)}
                                onMouseEnter={() => setHovered({ kind: 'link', id: link.id })}
                                onMouseLeave={() => setHovered(null)}
                                onFocus={() => focusAssociation('link', link.id)}
                                onBlur={() => setFocused(null)}
                            >
                                <Tooltip
                                    open={!contextSelection?.open && !browseOpen && previewId === `link:${link.id}`}
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
                                    renderAnchor={({ onClick, ...anchorProps }) => <RelationshipButton
                                        {...anchorProps}
                                        aria-haspopup="dialog"
                                        aria-label={`Relationship context: ${link.label} from ${source.name} to ${target.name}`}
                                        onClick={event => { onClick(event); showContext('link', link.id); }}
                                    >
                                        <span>
                                            <span className="relation">{relations[0]}</span>
                                            {model.compactLabels ? null : <span className="endpoints">{source.name} → {target.name}</span>}
                                            <span className="context-hint">
                                                {model.compactLabels ? `${link.edges.length} reference(s) · details` : <>
                                                {relations.length > 1
                                                    ? `+${relations.length - 1} more · `
                                                    : ''}
                                                Details · {link.confidence}
                                                </>}
                                            </span>
                                        </span>
                                    </RelationshipButton>}
                                />
                            </LinkLabel>
                        );
                    })}
                    {model.nodes.map((node) => (
                        <Node
                            key={node.id}
                            $selected={node.id === inspectedId}
                            $active={association.nodes.has(node.id)}
                            $x={node.x}
                            $y={node.y}
                            $zoom={zoom}
                            $width={geometry.nodeWidth}
                            $height={geometry.nodeHeight}
                            $compact={mode === 'overview'}
                            data-graph-node={node.id}
                            data-graph-highlighted={association.nodes.has(node.id)}
                            onMouseEnter={() => setHovered({ kind: 'node', id: node.id })}
                            onMouseLeave={() => setHovered(null)}
                            onFocus={() => focusAssociation('node', node.id)}
                            onBlur={() => setFocused(null)}
                        >
                            <Tooltip
                                open={!contextSelection?.open && !browseOpen && previewId === `node:${node.id}`}
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
                                        node.memberIds
                                            ? `${node.name}: ${node.memberIds?.length} grouped objects`
                                            : `Inspect ${node.name}`
                                    }
                                    onClick={() => selectNode(node)}
                                >
                                    <span className="node-label">
                                        <span className="name">{node.name}</span>
                                        {mode === 'detail' ? <small className="type">{node.objectType}</small> : null}
                                    </span>
                                </NodeSelect>
                            </Tooltip>
                            {nodeFooter(node)}
                        </Node>
                    ))}
                </Artboard>
            </Viewport>
            {context ? <GraphContextDialog
                key={`${contextSelection?.kind}:${contextSelection?.id}`}
                context={context}
                open={Boolean(contextSelection?.open && (contextNode || contextLink))}
                index={index}
                onClose={() =>
                    setContextSelection((current) => current && { ...current, open: false })
                }
                onInspect={onInspect}
                onFocusConnection={focusConnection}
                onFocusPath={focusPath}
                returnFocus={returnContextFocus}
            /> : null}
            {browseOpen ? <GraphContextDialog
                context={{ link: { id: 'captured-map-references', source: center.objectId, target: center.objectId,
                    label: 'Captured references in this expanded map scope', confidence: referenceConfidence, evidence: '', edges: allReferences } }}
                title="Browse captured connections" open index={index} onClose={() => setBrowseOpen(false)}
                onInspect={onInspect} onFocusConnection={focusConnection} onFocusPath={focusPath} returnFocus={returnContextFocus}
            /> : null}
        </GraphWorkspace>
    );
    return <>
        {maximized ? null : workspace}
        <Modal
            open={maximized}
            onRequestClose={closeMaximized}
            returnFocus={returnMaximizedFocus}
            style={{ width: 'calc(100vw - 16px)', maxWidth: 'none', height: 'calc(100vh - 48px)', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}
        >
            <FullWindowHeader title="Dependency tree" />
            <FullWindowBody data-content-hygiene-portal="true">
                {maximized ? workspace : null}
            </FullWindowBody>
        </Modal>
    </>;
}
