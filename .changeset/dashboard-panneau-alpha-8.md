---
'@eclair-js/dashboard': patch
---

Use Panneau `5.0.0-alpha.8`: its login page with the admin token and the "Log out" button of its sidebar replace the dashboard's own, its home route is the overview, and it loads the dashboard's messages. A refused token shows under the field. The dashboard typechecks on `NodeNext`, like the other packages, and ships 3 files without its own icon workaround.
