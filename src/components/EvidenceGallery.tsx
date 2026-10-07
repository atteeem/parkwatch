import React, { useEffect, useRef, useState } from "react";
import { FlatList, Modal, Pressable, StyleProp, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { EvidencePhoto } from "./EvidencePhoto";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { clampIndex, galleryCounter, galleryPageLabel, GalleryItem, indexFromOffset } from "../presentation/evidenceGallery";

/**
 * Full-screen evidence viewer: dark background, horizontal swipe with paging,
 * "1 / N" counter, caption and close. Photos render through EvidencePhoto, so
 * server evidence keeps using short-lived signed URLs (never a public link).
 * Previous/next buttons give screen-reader users the same navigation as a swipe.
 */
export function EvidenceGallery({
  items,
  index,
  onClose,
}: {
  items: GalleryItem[];
  /** Page to open at; null = closed. */
  index: number | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const listRef = useRef<FlatList<GalleryItem>>(null);
  const [page, setPage] = useState(0);
  const open = index !== null && items.length > 0;

  useEffect(() => {
    if (index !== null) setPage(clampIndex(index, items.length));
  }, [index, items.length]);

  const goTo = (i: number) => {
    const next = clampIndex(i, items.length);
    setPage(next);
    listRef.current?.scrollToIndex({ index: next, animated: !reduceMotion });
  };

  const current = items[page];
  return (
    <Modal visible={open} transparent={false} animationType={reduceMotion ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {open && (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(it) => it.key}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={clampIndex(index ?? 0, items.length)}
            getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(e) => setPage(indexFromOffset(e.nativeEvent.contentOffset.x, width, items.length))}
            renderItem={({ item }) => (
              <View style={{ width, height, justifyContent: "center" }}>
                <EvidencePhoto uri={item.uri} style={{ width, height: height * 0.72 }} contain />
              </View>
            )}
          />
        )}

        <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} style={styles.roundBtn} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close photos">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.counter} accessibilityLiveRegion="polite" accessibilityLabel={galleryPageLabel(current, page, items.length)}>
            {galleryCounter(page, items.length)}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 18 }]} pointerEvents="box-none">
          {items.length > 1 ? (
            <Pressable
              onPress={() => goTo(page - 1)}
              disabled={page === 0}
              style={[styles.roundBtn, page === 0 && styles.dim]}
              accessibilityRole="button"
              accessibilityLabel="Previous photo"
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <Text style={styles.caption} numberOfLines={1}>
            {current?.caption ?? ""}
          </Text>
          {items.length > 1 ? (
            <Pressable
              onPress={() => goTo(page + 1)}
              disabled={page >= items.length - 1}
              style={[styles.roundBtn, page >= items.length - 1 && styles.dim]}
              accessibilityRole="button"
              accessibilityLabel="Next photo"
            >
              <Ionicons name="chevron-forward" size={22} color="#fff" />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Tappable evidence thumbnails that open the shared gallery at the tapped photo. */
export function EvidenceThumbnails({
  items,
  thumbStyle,
  max,
  style,
}: {
  items: GalleryItem[];
  thumbStyle: React.ComponentProps<typeof EvidencePhoto>["style"];
  /** Show at most this many; the last visible thumb says "+N". All photos stay swipeable. */
  max?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const shown = max !== undefined && items.length > max ? items.slice(0, max) : items;
  const hidden = items.length - shown.length;
  return (
    <>
      <View style={[{ flexDirection: "row", gap: 6 }, style]}>
        {shown.map((it, i) => (
          <Pressable
            key={it.key}
            style={{ flex: 1 }}
            onPress={() => setOpenAt(i)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${it.caption} photo, open full screen`}
          >
            <EvidencePhoto uri={it.uri} style={thumbStyle} compact />
            {hidden > 0 && i === shown.length - 1 ? (
              <View style={styles.moreOverlay} pointerEvents="none">
                <Text style={styles.moreLabel}>+{hidden}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
      <EvidenceGallery items={items} index={openAt} onClose={() => setOpenAt(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.35 },
  counter: { color: "#fff", fontSize: 15, fontWeight: "800" },
  caption: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center", marginHorizontal: 12 },
  moreOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  moreLabel: { color: "#fff", fontWeight: "800" },
});
