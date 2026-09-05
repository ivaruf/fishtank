# You bite something: a snap and a wet blup.
with_fx :reverb, room: 0.35, mix: 0.2 do
  sample :perc_snap2, amp: 0.9, rate: 0.85
  sample :elec_blup, amp: 0.8, rate: 0.7
  use_synth :bnoise
  play 60, release: 0.14, cutoff: 95, amp: 0.45
  sleep 0.08
  use_synth :sine
  play 50, release: 0.25, amp: 0.5
end
