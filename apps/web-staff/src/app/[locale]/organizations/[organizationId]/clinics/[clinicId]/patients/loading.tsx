import { getTranslations } from "next-intl/server";

export default async function LoadingPatients() {
  const t = await getTranslations("patients");
  return (
    <main className="entry-layout">
      <p className="directory-main" role="status">
        {t("loading")}
      </p>
    </main>
  );
}
