import { getTranslations } from "next-intl/server";
export default async function LoadingDocuments() {
  const t = await getTranslations("webDocuments");
  return (
    <main className="entry-layout">
      <p className="directory-main" role="status">
        {t("loading")}
      </p>
    </main>
  );
}
