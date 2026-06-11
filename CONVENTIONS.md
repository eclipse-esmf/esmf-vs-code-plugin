# ESMF Code Conventions
The following document contains a compilation of conventions and guidelines to format, structure and
write code for the ESMF Visual Studio Code Plugin schematics.

## General Conventions

Our code conventions are based on the [Google Typescript Style Guide](https://google.github.io/styleguide/tsguide.html)
but
detailed and adjusted for the needs of the ESMF Visual Studio Code Plugin JS schematics.

## Copyright header
See [CONTRIBUTING](CONTRIBUTING.md)

## Code Recommendations

This project uses the library [Prettier](https://www.npmjs.com/package/prettier) and should also be created with it, so
that a clear code can be created.

## Documentation

### Developer Documentation
Developer documentation is put into a README.md placed in the project root. This should contain documentation like:
* Checking out the source code and getting it to run/build
* Mandatory (external system) dependencies and how to set them up (e.g. databases)
* Configuration options and how to apply them
* General important concepts that are relevant to working on the project but are not directly obvious from the source code
  itself. Links to further readings and information, e.g. wiki or other external sources.

