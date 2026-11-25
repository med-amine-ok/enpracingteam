// No page title of its own: the tab shows the app's name, so that the scoring is never named to
// someone who may not see it (front guide §2.1).
import { Suspense } from "react";
import { MemberScoresPage } from "@/features/scoring/member-scores";

// What is shown depends on the viewer's scoring rights and the address: read in the browser, inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <MemberScoresPage />
    </Suspense>
  );
}
