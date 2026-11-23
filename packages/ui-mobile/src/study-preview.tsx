import type { components } from "@vetx/api-client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AppState, Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, type AccessStyles } from "./controls";
import { preparePreview } from "./document-files";
import type { MobileAccount } from "./session";
type PrivatePreview = NonNullable<Awaited<ReturnType<typeof preparePreview>>>;
export function StudyPreview({
  imaging,
  title,
  download,
  account,
  styles,
}: {
  imaging?: components["schemas"]["DicomMetadataDto"];
  title: string;
  download: () => Promise<Uint8Array>;
  account: MobileAccount;
  styles: AccessStyles;
}) {
  const { t } = useTranslation();
  const [details, setDetails] = useState(false),
    [uri, setUri] = useState<string>(),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const generation = useRef(0),
    lock = useRef(false),
    file = useRef<PrivatePreview | undefined>(undefined);
  const clear = useCallback(() => {
    generation.current++;
    lock.current = false;
    file.current?.close();
    file.current = undefined;
  }, []);
  const hide = useCallback(() => {
    clear();
    setUri(undefined);
    setBusy(false);
    setFailed(false);
  }, [clear]);
  useLayoutEffect(() => {
    hide();
    setDetails(false);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") hide();
    });
    return () => {
      subscription.remove();
      clear();
    };
  }, [account, imaging?.preview?.sha256, clear, hide]);
  async function show() {
    if (lock.current || !imaging?.preview) return;
    lock.current = true;
    setFailed(false);
    setBusy(true);
    const ticket = generation.current,
      active = () => ticket === generation.current;
    try {
      const frame = await preparePreview(download, active);
      if (!frame) return;
      if (!active()) {
        frame.close();
        return;
      }
      file.current = frame;
      setUri(frame.uri);
    } catch {
      if (active()) setFailed(true);
    } finally {
      if (active()) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <View style={styles.section}>
      {imaging && (
        <>
          <Text style={styles.support}>
            {t("nativeDocuments.imageSummary", {
              modality: imaging.modality,
              frames: imaging.frames,
            })}
          </Text>
          <View style={styles.actions}>
            <Action
              label={t("nativeDocuments.imageDetails")}
              expanded={details}
              styles={styles}
              onPress={() => setDetails((v) => !v)}
            />
          </View>
          {details &&
            (["studyInstanceUid", "seriesInstanceUid", "sopInstanceUid"] as const).map((k) => (
              <Text key={k} selectable style={styles.support}>
                {t(`nativeDocuments.${k}`)} · {imaging[k]}
              </Text>
            ))}
        </>
      )}
      {imaging?.preview ? (
        <>
          <View style={styles.actions}>
            <Action
              label={t(
                uri
                  ? "nativeDocuments.hidePreview"
                  : failed
                    ? "nativeDocuments.retryPreview"
                    : "nativeDocuments.viewPreview",
              )}
              expanded={!!uri}
              busy={busy}
              styles={styles}
              onPress={uri ? hide : () => void show()}
            />
          </View>
          {failed && (
            <Text accessibilityRole="alert" style={styles.error}>
              {t("nativeDocuments.previewFailed")}
            </Text>
          )}
          {uri && (
            <Image
              accessible
              accessibilityRole="image"
              accessibilityLabel={t("nativeDocuments.frameAlt", { title })}
              source={{ uri, cache: "reload" }}
              resizeMode="contain"
              style={{ width: "100%", height: 240 }}
              onError={() => {
                if (file.current?.uri === uri) {
                  hide();
                  setFailed(true);
                }
              }}
            />
          )}
        </>
      ) : (
        <Text style={styles.support}>{t("nativeDocuments.noPreview")}</Text>
      )}
    </View>
  );
}
