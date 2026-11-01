# SPDX-License-Identifier: AGPL-3.0-or-later
class Normalizer:
    """Accepts NeMo's constructor arguments and leaves text untouched."""

    def __init__(self, *args, **kwargs):
        self.lang = kwargs.get("lang", "en")

    def normalize(self, text, *args, **kwargs):
        return text
