import { getTranslations } from "next-intl/server";
export default async function Loading() {
  const t = await getTranslations("webExchange");
  return (
    <main className="entry-layout">
      <p className="directory-main" role="status">
        {t("loadingHistory")}
      </p>
    </main>
  );
}
