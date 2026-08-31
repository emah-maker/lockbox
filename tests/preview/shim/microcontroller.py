# microcontroller.py -- host stand-in for CircuitPython's microcontroller
# module. lock_settings.Settings reads/writes `microcontroller.nvm` as a
# byte-indexable object; `nvm = None` here makes Settings() fall through to
# its compiled-in defaults cleanly (see Settings._load/save's `if nvm is
# None: return` / `nvm is not None` guards) -- exactly the "no NVM on this
# host" case those guards were written for, not a special case invented
# for this shim.
nvm = None
