import { defaultLocale, isLocale } from "@vetx/i18n";
import { getLocale } from "next-intl/server";
import { inventoryMessages } from "../../../../../../../inventory/messages.ts";
export default async function Loading() {
  const locale = await getLocale();
  return (
    <main className="entry-layout">
      <p role="status" className="directory-main">
        {inventoryMessages(isLocale(locale) ? locale : defaultLocale)("loading")}
      </p>
    </main>
  );
}
