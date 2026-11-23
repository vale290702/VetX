import { readFile } from "node:fs/promises";
import { sealVetpkg, type VetpkgManifest, type ExchangeKeyBinding } from "@vetx/exchange";
import { exchangeKeyringPath } from "./exchange-run.ts";

type Scope = VetpkgManifest["source"];
type Lane = "api" | "web-desktop" | "web-mobile-dark";
type Route = { source: Scope; destination: Scope };
type Clinic = Scope & {
  name: string;
  signing: ExchangeKeyBinding[];
  encryption: ExchangeKeyBinding[];
};
async function clinics(): Promise<Clinic[]> {
  return JSON.parse(await readFile(exchangeKeyringPath(), "utf8")).clinics;
}

export async function readExchangeRoute(lane: Lane): Promise<Route> {
  const keys = await clinics();
  const scope = (role: string): Scope => {
    const clinic = keys.find((c) => c.name === lane + " " + role);
    if (!clinic) throw new Error("Missing test exchange clinic");
    return { organizationId: clinic.organizationId, clinicId: clinic.clinicId };
  };
  return { source: scope("source"), destination: scope("destination") };
}

export async function sealFixturePackage(
  route: Route,
  manifest: Omit<VetpkgManifest, "source" | "destination">,
) {
  const keys = await clinics();
  const find = (scope: Scope) =>
    keys.find((c) => c.clinicId === scope.clinicId && c.organizationId === scope.organizationId);
  const signer = find(route.source)?.signing[0],
    binding = find(route.destination)?.encryption[0];
  if (!signer || !binding) throw new Error("Missing test exchange keys");
  const { kty, crv, x } = binding.jwk;
  return Buffer.from(
    await sealVetpkg(
      { ...manifest, ...route },
      { signer, recipient: { ...binding, jwk: { kty, crv, x } } },
    ),
  );
}
