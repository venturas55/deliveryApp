import React, { createContext, useContext, useState } from "react";
import { View, useWindowDimensions } from "react-native";

export const CONTENT_MAX_WIDTH = 1120;
export const CONTENT_PADDING = 18;
export const GRID_GAP = 12;
export const SIDEBAR_WIDTH = 200;

const ContentWidth = createContext(null);

// Measure the actual pane, not device class: rotation and split-screen change usable width.
export function ContentPane({ children, style }) {
  const [width, setWidth] = useState(null);
  return <View style={[{ flex: 1, minWidth: 0 }, style]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <ContentWidth.Provider value={width}>{children}</ContentWidth.Provider>
  </View>;
}

export function columnsForWidth(width, minWidth = 320, maxColumns = 3, fontScale = 1) {
  return Math.max(1, Math.min(maxColumns, Math.floor((width + GRID_GAP) / (minWidth * Math.max(1, fontScale) + GRID_GAP))));
}

export function useContentLayout(minWidth = 320, maxColumns = 3) {
  const window = useWindowDimensions();
  const paneWidth = useContext(ContentWidth) ?? window.width;
  const width = Math.max(0, Math.min(paneWidth, CONTENT_MAX_WIDTH) - CONTENT_PADDING * 2);
  const columns = columnsForWidth(width, minWidth, maxColumns, window.fontScale);
  return { columns, itemWidth: Math.max(0, (width - GRID_GAP * (columns - 1)) / columns) };
}

export function Grid({ children, minWidth = 320, maxColumns = 3 }) {
  const { columns, itemWidth } = useContentLayout(minWidth, maxColumns);
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP }}>
    {React.Children.toArray(children).map(child => <View key={child.key} style={{ width: columns === 1 ? "100%" : itemWidth, minWidth: 0 }}>{child}</View>)}
  </View>;
}
