import { useLayoutEffect, useRef } from "react";
import { DocumentFileError, openPrivateFile } from "./document-files";
import { packageType } from "./exchange-forms";
import { PatientError } from "./patient-transport";
import { usePatientAction } from "./patient-controls";
import type { MobileAccount } from "./session";

export const vetpkgFormat = { extension: "vetpkg", mimeType: packageType };
export function useExchangeHandoff(account: MobileAccount) {
  const action = usePatientAction(account),
    generation = useRef(0);
  useLayoutEffect(
    () => () => {
      generation.current++;
    },
    [account],
  );
  function open(
    format: { extension: string; mimeType: string; uti?: string },
    download: () => Promise<Uint8Array>,
    title: string,
  ) {
    const current = generation.current;
    void action.run(
      async () => {
        try {
          await openPrivateFile(format, download, () => generation.current === current, title);
        } catch (error) {
          if (error instanceof DocumentFileError)
            throw new PatientError(400, "HANDOFF_UNAVAILABLE");
          throw error;
        }
      },
      () => {},
    );
  }
  return { ...action, open };
}
