import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { PageTitle, PublicLayout } from "./components/Layout";
import { ButtonLink, Spinner } from "./components/ui";
import { common } from "./copy";
import { Claim } from "./pages/Claim";
import { Home } from "./pages/Home";

// Home and Claim (the recipient's phone) are in the main bundle; everything else is code-split,
// so recharts, the QR library and the admin screens never slow down the claim page.
const Donate = lazy(() => import("./pages/Donate"));
const Transparency = lazy(() => import("./pages/Transparency"));
const Login = lazy(() => import("./pages/Login"));
const Admin = lazy(() => import("./pages/Admin"));
const NewPayout = lazy(() => import("./pages/NewPayout"));
const Reports = lazy(() => import("./pages/Reports"));

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-subtle">
      <Spinner className="size-7" />
    </div>
  );
}

function NotFound() {
  return (
    <PublicLayout>
      <PageTitle title={common.notFoundTitle} sub={common.notFoundBody} />
      <ButtonLink to="/" variant="dark">
        {common.home}
      </ButtonLink>
    </PublicLayout>
  );
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/c/:id" element={<Claim />} />
        <Route path="/donate" element={<Donate />} />
        <Route path="/transparency" element={<Transparency />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/payouts/new" element={<NewPayout />} />
        <Route path="/admin/reports" element={<Reports />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
