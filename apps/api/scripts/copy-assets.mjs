// Copies non-TS assets that the compiled API reads at runtime into dist/.
import { cpSync } from "node:fs";

cpSync(new URL("../src/db/migrations.sql", import.meta.url), new URL("../dist/db/migrations.sql", import.meta.url));
