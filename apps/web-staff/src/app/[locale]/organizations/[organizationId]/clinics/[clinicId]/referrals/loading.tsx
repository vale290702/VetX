import { defaultLocale, isLocale } from "@vetx/i18n";
import { getLocale } from "next-intl/server";
import { referralMessages } from "../../../../../../../referrals/messages.ts";
export default async function Loading() {
  const locale = await getLocale();
  return (
    <main className="entry-layout">
      <p className="directory-main" role="status">
        {referralMessages(isLocale(locale) ? locale : defaultLocale)("loading")}
      </p>
    </main>
  );
}
